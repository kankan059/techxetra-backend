import { eq, and, sql, or, ne, inArray } from 'drizzle-orm';
import { db } from '../db';
import { teams, teamMembers, events, users, registrations } from '../db/schema';
import { AppError } from '../common/errors';
import { checkProfileCompleteness } from './user.service';
import type { UserSelect } from '../types/express';

export async function createTeam(leader: UserSelect, eventId: string, name: string) {
  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 50) {
    throw AppError.badRequest('Team name must be between 2 and 50 characters');
  }

  // 1. Fetch event and verify it supports teams and is open
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) {
    throw AppError.notFound(`Event '${eventId}' not found`);
  }

  if (event.status !== 'OPEN') {
    throw AppError.badRequest(`Cannot create team for event with status '${event.status}'`, 'EVENT_NOT_OPEN');
  }

  const allowsTeam = event.isTeam === 1 || event.format === 'TEAM' || event.format === 'EITHER';
  if (!allowsTeam) {
    throw AppError.badRequest('This event does not allow team registrations', 'NOT_A_TEAM_EVENT');
  }

  // 2. Check if leader is already leading an active team for this event
  const [existingLedTeam] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.eventId, eventId), eq(teams.leaderId, leader.id), ne(teams.status, 'CANCELLED')))
    .limit(1);

  if (existingLedTeam) {
    throw AppError.conflict(
      `You are already leading active team '${existingLedTeam.name}' for this event`,
      'ALREADY_LEADING_TEAM'
    );
  }

  // 3. Check if leader is an accepted member in another active team for this event
  const [existingMembership] = await db
    .select({
      member: teamMembers,
      team: teams,
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(
      and(
        eq(teams.eventId, eventId),
        eq(teamMembers.userId, leader.id),
        eq(teamMembers.status, 'ACCEPTED'),
        ne(teams.status, 'CANCELLED')
      )
    )
    .limit(1);

  if (existingMembership) {
    throw AppError.conflict(
      `You are already a member of team '${existingMembership.team.name}' for this event`,
      'ALREADY_IN_TEAM'
    );
  }

  // 4. Check if leader already has an active registration for this event
  const [existingReg] = await db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.participantId, leader.id),
        inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
      )
    )
    .limit(1);

  if (existingReg) {
    throw AppError.conflict('You already have an active registration for this event', 'ALREADY_REGISTERED');
  }

  // 5. Check if team name is taken for this event (case-insensitive)
  const [existingName] = await db
    .select()
    .from(teams)
    .where(
      and(
        eq(teams.eventId, eventId),
        sql`lower(${teams.name}) = lower(${trimmedName})`,
        ne(teams.status, 'CANCELLED')
      )
    )
    .limit(1);

  if (existingName) {
    throw AppError.conflict(`Team name '${trimmedName}' is already taken for this event`, 'TEAM_NAME_TAKEN');
  }

  const now = Date.now();

  // 6. Create team and add leader as accepted member in a transaction
  return await db.transaction(async (tx) => {
    const [newTeam] = await tx
      .insert(teams)
      .values({
        eventId,
        name: trimmedName,
        leaderId: leader.id,
        status: 'DRAFT',
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const [leaderMember] = await tx
      .insert(teamMembers)
      .values({
        teamId: newTeam.id,
        userId: leader.id,
        invitedEmail: leader.email.toLowerCase().trim(),
        role: 'LEADER',
        status: 'ACCEPTED',
        respondedAt: now,
        createdAt: now,
      })
      .returning();

    return {
      ...newTeam,
      members: [leaderMember],
    };
  });
}

export async function getTeamById(teamId: string, requestingUserId?: string, isStaffOrAdmin = false) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) {
    throw AppError.notFound(`Team '${teamId}' not found`);
  }

  const members = await db
    .select({
      id: teamMembers.id,
      teamId: teamMembers.teamId,
      userId: teamMembers.userId,
      invitedEmail: teamMembers.invitedEmail,
      role: teamMembers.role,
      status: teamMembers.status,
      respondedAt: teamMembers.respondedAt,
      createdAt: teamMembers.createdAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        avatarUrl: users.avatarUrl,
        isStudent: users.isStudent,
        institutionName: users.institutionName,
        institutionId: users.institutionId,
        profileCompletedAt: users.profileCompletedAt,
      },
    })
    .from(teamMembers)
    .leftJoin(users, eq(teamMembers.userId, users.id))
    .where(eq(teamMembers.teamId, teamId));

  // Access control: only members, leader, or staff/admin can view team details
  if (!isStaffOrAdmin && requestingUserId) {
    const isMember = members.some((m) => m.userId === requestingUserId);
    const isLeader = team.leaderId === requestingUserId;
    if (!isMember && !isLeader) {
      throw AppError.notFound(`Team '${teamId}' not found`);
    }
  }

  const [event] = await db.select().from(events).where(eq(events.id, team.eventId)).limit(1);

  return {
    ...team,
    event,
    members,
  };
}

export async function getUserTeams(userId: string, userEmail: string) {
  const normalizedEmail = userEmail.toLowerCase().trim();

  // Find all team IDs where user is member or invited
  const memberRecords = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        or(eq(teamMembers.userId, userId), eq(sql`lower(${teamMembers.invitedEmail})`, normalizedEmail)),
        inArray(teamMembers.status, ['INVITED', 'ACCEPTED'])
      )
    );

  const teamIds = Array.from(new Set(memberRecords.map((r) => r.teamId)));

  if (teamIds.length === 0) {
    return [];
  }

  const teamList = await db
    .select({
      team: teams,
      event: {
        id: events.id,
        slug: events.slug,
        title: events.title,
        status: events.status,
        minTeamSize: events.minTeamSize,
        maxTeamSize: events.maxTeamSize,
      },
    })
    .from(teams)
    .innerJoin(events, eq(teams.eventId, events.id))
    .where(and(inArray(teams.id, teamIds), ne(teams.status, 'CANCELLED')));

  return teamList.map((t) => ({
    ...t.team,
    event: t.event,
  }));
}

export async function renameTeam(teamId: string, leaderId: string, newName: string) {
  const trimmedName = newName.trim();
  if (trimmedName.length < 2 || trimmedName.length > 50) {
    throw AppError.badRequest('Team name must be between 2 and 50 characters');
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || team.status === 'CANCELLED') {
    throw AppError.notFound(`Team '${teamId}' not found`);
  }

  if (team.leaderId !== leaderId) {
    throw AppError.forbidden('Only the team leader can rename the team');
  }

  if (team.status !== 'DRAFT') {
    throw AppError.badRequest(`Cannot rename team in status '${team.status}'`, 'TEAM_LOCKED');
  }

  // Check unique name for event
  const [existingName] = await db
    .select()
    .from(teams)
    .where(
      and(
        eq(teams.eventId, team.eventId),
        sql`lower(${teams.name}) = lower(${trimmedName})`,
        ne(teams.id, teamId),
        ne(teams.status, 'CANCELLED')
      )
    )
    .limit(1);

  if (existingName) {
    throw AppError.conflict(`Team name '${trimmedName}' is already taken for this event`, 'TEAM_NAME_TAKEN');
  }

  const [updated] = await db
    .update(teams)
    .set({
      name: trimmedName,
      updatedAt: Date.now(),
    })
    .where(eq(teams.id, teamId))
    .returning();

  return updated;
}

export async function inviteMember(teamId: string, leaderId: string, invitedEmail: string) {
  const normalizedEmail = invitedEmail.toLowerCase().trim();

  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || team.status === 'CANCELLED') {
    throw AppError.notFound(`Team '${teamId}' not found`);
  }

  if (team.leaderId !== leaderId) {
    throw AppError.forbidden('Only the team leader can invite members');
  }

  if (team.status !== 'DRAFT') {
    throw AppError.badRequest(`Cannot invite members to team in status '${team.status}'`, 'TEAM_LOCKED');
  }

  const [event] = await db.select().from(events).where(eq(events.id, team.eventId)).limit(1);
  if (!event) {
    throw AppError.notFound('Event not found');
  }

  // Check team size limit
  const activeMembers = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.status, ['INVITED', 'ACCEPTED'])));

  if (activeMembers.length >= event.maxTeamSize) {
    throw AppError.badRequest(
      `Cannot invite more members. Maximum team size is ${event.maxTeamSize}`,
      'TEAM_FULL'
    );
  }

  // Check if email is already in this team
  const alreadyInTeam = activeMembers.some((m) => m.invitedEmail.toLowerCase().trim() === normalizedEmail);
  if (alreadyInTeam) {
    throw AppError.conflict('This email has already been invited or is a member of this team', 'ALREADY_INVITED');
  }

  // Check if this email belongs to an existing user who is already accepted in another team for this event
  const [existingUser] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

  if (existingUser) {
    const [conflictMembership] = await db
      .select({ team: teams })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(
        and(
          eq(teams.eventId, team.eventId),
          eq(teamMembers.userId, existingUser.id),
          eq(teamMembers.status, 'ACCEPTED'),
          ne(teams.status, 'CANCELLED')
        )
      )
      .limit(1);

    if (conflictMembership) {
      throw AppError.conflict(
        `User is already an accepted member of team '${conflictMembership.team.name}' for this event`,
        'USER_ALREADY_IN_ANOTHER_TEAM'
      );
    }
  }

  const now = Date.now();
  const [member] = await db
    .insert(teamMembers)
    .values({
      teamId,
      userId: existingUser?.id ?? null,
      invitedEmail: normalizedEmail,
      role: 'MEMBER',
      status: 'INVITED',
      createdAt: now,
    })
    .returning();

  return member;
}

export async function removeMemberOrLeave(teamId: string, memberId: string, requestingUserId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || team.status === 'CANCELLED') {
    throw AppError.notFound(`Team '${teamId}' not found`);
  }

  if (team.status !== 'DRAFT') {
    throw AppError.badRequest(`Cannot modify roster of a team in status '${team.status}'`, 'TEAM_LOCKED');
  }

  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, memberId)).limit(1);
  if (!member || member.teamId !== teamId) {
    throw AppError.notFound(`Team member record not found`);
  }

  const isLeader = team.leaderId === requestingUserId;
  const isSelf = member.userId === requestingUserId;

  if (isSelf && member.role === 'LEADER') {
    throw AppError.badRequest(
      'The team leader cannot leave the team. You must disband the team or transfer leadership.',
      'LEADER_CANNOT_LEAVE'
    );
  }

  if (!isLeader && !isSelf) {
    throw AppError.forbidden('You do not have permission to remove this member');
  }

  const [updated] = await db
    .update(teamMembers)
    .set({
      status: 'REMOVED',
      respondedAt: Date.now(),
    })
    .where(eq(teamMembers.id, memberId))
    .returning();

  return updated;
}

export async function disbandTeam(teamId: string, leaderId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || team.status === 'CANCELLED') {
    throw AppError.notFound(`Team '${teamId}' not found`);
  }

  if (team.leaderId !== leaderId) {
    throw AppError.forbidden('Only the team leader can disband the team');
  }

  if (team.status !== 'DRAFT') {
    throw AppError.badRequest(`Cannot disband team in status '${team.status}'`, 'TEAM_LOCKED');
  }

  const [updated] = await db
    .update(teams)
    .set({
      status: 'CANCELLED',
      updatedAt: Date.now(),
    })
    .where(eq(teams.id, teamId))
    .returning();

  return updated;
}

export async function getPendingInvitations(userId: string, userEmail: string) {
  const normalizedEmail = userEmail.toLowerCase().trim();

  const invites = await db
    .select({
      invitationId: teamMembers.id,
      invitedEmail: teamMembers.invitedEmail,
      createdAt: teamMembers.createdAt,
      team: {
        id: teams.id,
        name: teams.name,
        status: teams.status,
      },
      event: {
        id: events.id,
        slug: events.slug,
        title: events.title,
        category: events.category,
        festDay: events.festDay,
        venue: events.venue,
      },
      leader: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .innerJoin(events, eq(teams.eventId, events.id))
    .innerJoin(users, eq(teams.leaderId, users.id))
    .where(
      and(
        or(eq(teamMembers.userId, userId), eq(sql`lower(${teamMembers.invitedEmail})`, normalizedEmail)),
        eq(teamMembers.status, 'INVITED'),
        eq(teams.status, 'DRAFT')
      )
    );

  return invites;
}

export async function respondToInvitation(invitationId: string, user: UserSelect, accept: boolean) {
  const [member] = await db.select().from(teamMembers).where(eq(teamMembers.id, invitationId)).limit(1);
  if (!member) {
    throw AppError.notFound('Invitation not found');
  }

  if (member.status !== 'INVITED') {
    throw AppError.badRequest(`Invitation has already been responded to (${member.status})`, 'ALREADY_RESPONDED');
  }

  const normalizedUserEmail = user.email.toLowerCase().trim();
  const normalizedInviteEmail = member.invitedEmail.toLowerCase().trim();

  if (member.userId && member.userId !== user.id) {
    throw AppError.forbidden('This invitation was sent to a different user account');
  }

  if (normalizedUserEmail !== normalizedInviteEmail && member.userId !== user.id) {
    throw AppError.forbidden('Your email does not match the invitation email address');
  }

  const [team] = await db.select().from(teams).where(eq(teams.id, member.teamId)).limit(1);
  if (!team || team.status !== 'DRAFT') {
    throw AppError.badRequest('Team is no longer accepting new members', 'TEAM_LOCKED');
  }

  const now = Date.now();

  if (!accept) {
    const [updated] = await db
      .update(teamMembers)
      .set({
        status: 'DECLINED',
        respondedAt: now,
      })
      .where(eq(teamMembers.id, invitationId))
      .returning();
    return updated;
  }

  // Accept Flow
  // 1. Profile completeness check
  const { isComplete, missingFields } = checkProfileCompleteness(user);
  if (!isComplete) {
    throw AppError.badRequest(
      'You must complete your profile before accepting a team invitation',
      'PROFILE_INCOMPLETE',
      { missingFields }
    );
  }

  // 2. Check team size
  const [event] = await db.select().from(events).where(eq(events.id, team.eventId)).limit(1);
  const acceptedMembers = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.status, 'ACCEPTED')));

  if (acceptedMembers.length >= event.maxTeamSize) {
    throw AppError.badRequest(`Team roster is already full (${event.maxTeamSize} members)`, 'TEAM_FULL');
  }

  // 3. Check if user belongs to another team for this event
  const [conflictMembership] = await db
    .select({ team: teams })
    .from(teamMembers)
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .where(
      and(
        eq(teams.eventId, team.eventId),
        eq(teamMembers.userId, user.id),
        eq(teamMembers.status, 'ACCEPTED'),
        ne(teams.id, team.id),
        ne(teams.status, 'CANCELLED')
      )
    )
    .limit(1);

  if (conflictMembership) {
    throw AppError.conflict(
      `You are already an accepted member of team '${conflictMembership.team.name}' for this event`,
      'ALREADY_IN_ANOTHER_TEAM'
    );
  }

  const [updated] = await db
    .update(teamMembers)
    .set({
      userId: user.id,
      status: 'ACCEPTED',
      respondedAt: now,
    })
    .where(eq(teamMembers.id, invitationId))
    .returning();

  return updated;
}

export async function validateTeamForPurchase(teamId: string, leaderId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team || team.status === 'CANCELLED') {
    throw AppError.notFound(`Team '${teamId}' not found`);
  }

  if (team.status !== 'DRAFT') {
    throw AppError.badRequest(
      `Team must be in DRAFT status to reserve passes. Current status: ${team.status}`,
      'TEAM_NOT_DRAFT'
    );
  }

  if (team.leaderId !== leaderId) {
    throw AppError.forbidden('Only the team leader can purchase passes for the team');
  }

  const [event] = await db.select().from(events).where(eq(events.id, team.eventId)).limit(1);
  if (!event) {
    throw AppError.notFound('Event not found');
  }

  // Fetch accepted members
  const acceptedMembers = await db
    .select({
      member: teamMembers,
      user: users,
    })
    .from(teamMembers)
    .leftJoin(users, eq(teamMembers.userId, users.id))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.status, 'ACCEPTED')));

  if (acceptedMembers.length < event.minTeamSize) {
    throw AppError.badRequest(
      `Team does not meet minimum size requirement. Current: ${acceptedMembers.length}, Minimum: ${event.minTeamSize}`,
      'TEAM_SIZE_INSUFFICIENT'
    );
  }

  if (acceptedMembers.length > event.maxTeamSize) {
    throw AppError.badRequest(
      `Team exceeds maximum size requirement. Current: ${acceptedMembers.length}, Maximum: ${event.maxTeamSize}`,
      'TEAM_SIZE_EXCEEDED'
    );
  }

  // Verify all accepted members have completed profiles
  for (const { member, user } of acceptedMembers) {
    if (!user) {
      throw AppError.badRequest(
        `Team member with email '${member.invitedEmail}' has not created an account yet`,
        'MEMBER_NO_ACCOUNT'
      );
    }

    const { isComplete, missingFields } = checkProfileCompleteness(user);
    if (!isComplete) {
      throw AppError.badRequest(
        `Member '${user.name}' (${user.email}) has an incomplete profile. Missing: ${missingFields.join(', ')}`,
        'MEMBER_PROFILE_INCOMPLETE'
      );
    }
  }

  // Verify none of the members already has a registration for this event
  const memberUserIds = acceptedMembers.map((m) => m.user!.id);
  const existingRegistrations = await db
    .select()
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, event.id),
        inArray(registrations.participantId, memberUserIds),
        inArray(registrations.status, ['RESERVED', 'CONFIRMED'])
      )
    );

  if (existingRegistrations.length > 0) {
    throw AppError.conflict(
      'One or more team members are already registered for this event',
      'MEMBER_ALREADY_REGISTERED'
    );
  }

  return {
    team,
    event,
    acceptedMembers,
  };
}

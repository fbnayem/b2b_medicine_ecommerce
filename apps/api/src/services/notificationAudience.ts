import { ClientSession, Types } from 'mongoose';
import { UserRole, UserStatus } from '@medsupply/shared-types';
import { Shop } from '../models/Shop';
import { User } from '../models/User';

export const MANAGEMENT_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
];

export const ADMIN_ROLES: UserRole[] = [UserRole.SUPER_ADMIN, UserRole.ADMIN];

/** Active users holding any of the given roles. Inactive accounts are never notified. */
export async function userIdsWithRoles(
  roles: UserRole[],
  session?: ClientSession,
): Promise<Types.ObjectId[]> {
  if (!roles.length) return [];
  const query = User.find({ role: { $in: roles }, status: UserStatus.ACTIVE }).select('_id');
  if (session) query.session(session);
  const users = await query.lean();
  return users.map((user) => user._id as Types.ObjectId);
}

export async function shopOwnerIds(
  shopId: Types.ObjectId | string,
  session?: ClientSession,
): Promise<Types.ObjectId[]> {
  const query = Shop.findById(shopId).select('ownerIds managerId');
  if (session) query.session(session);
  const shop = await query.lean();
  return (shop?.ownerIds as Types.ObjectId[] | undefined) ?? [];
}

/** The assigned manager plus every admin — the standard internal audience for an order. */
export async function shopManagementIds(
  shopId: Types.ObjectId | string,
  session?: ClientSession,
): Promise<Types.ObjectId[]> {
  const query = Shop.findById(shopId).select('managerId');
  if (session) query.session(session);
  const shop = await query.lean();
  const admins = await userIdsWithRoles(ADMIN_ROLES, session);
  const managerId = shop?.managerId as Types.ObjectId | undefined;
  return managerId ? [managerId, ...admins] : admins;
}

/** Shop owners for a shop id that may already be populated on a document. */
export async function ownersForShop(
  shop: { _id: Types.ObjectId; ownerIds?: Types.ObjectId[] } | null | undefined,
  session?: ClientSession,
): Promise<Types.ObjectId[]> {
  if (!shop) return [];
  if (shop.ownerIds?.length) return shop.ownerIds;
  return shopOwnerIds(shop._id, session);
}

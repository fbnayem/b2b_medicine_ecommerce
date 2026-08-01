import { NextFunction, Response } from 'express';
import { SettingsGroup, UserRole } from '@medsupply/shared-types';
import { SettingsResetSchema, SettingsUpdateSchema } from '@medsupply/validation';
import { AuthRequest } from '../middlewares/auth';
import {
  brandingSettings,
  getSettingsWithMetadata,
  resetSettingsGroup,
  updateSettingsGroup,
  type SettingsActor,
} from '../services/settingsService';
import { environmentSettings, GROUP_DESCRIPTIONS } from '../services/settingsDefaults';

const actor = (req: AuthRequest): SettingsActor => ({
  _id: req.user!._id,
  role: req.user!.role as UserRole,
  ipAddress: req.ip,
  userAgent: req.get('user-agent'),
});

/**
 * Branding and display formatting for every signed-in client. Deliberately
 * excludes credit, security and finance policy, so a Shop Owner reading it
 * learns nothing about internal controls.
 */
export async function branding(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    res.json({ data: await brandingSettings() });
  } catch (error) {
    next(error);
  }
}

/** Full administrative view: effective values, provenance and per-group versions. */
export async function listSettings(_req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { settings, sources, versions } = await getSettingsWithMetadata();
    res.json({
      data: {
        settings,
        sources,
        versions,
        descriptions: GROUP_DESCRIPTIONS,
        // What each group would fall back to if its override were removed.
        fallbacks: environmentSettings(),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = SettingsUpdateSchema.parse({ ...req.body, group: req.params.group });
    const result = await updateSettingsGroup({
      group: input.group as SettingsGroup,
      values: input.values,
      version: input.version,
      actor: actor(req),
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

export async function resetSettings(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const input = SettingsResetSchema.parse({ ...req.body, group: req.params.group });
    const result = await resetSettingsGroup({
      group: input.group as SettingsGroup,
      version: input.version,
      reason: input.reason,
      actor: actor(req),
    });
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
}

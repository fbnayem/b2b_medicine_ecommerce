import { Router } from 'express';
import {
  changePassword,
  listOwnSessions,
  login,
  logout,
  logoutAll,
  refresh,
  revokeOwnSession,
} from '../controllers/authController';
import { requireAuth } from '../middlewares/auth';
import { authRateLimit } from '../middlewares/rateLimit';

const router = Router();

// Sign-in and rotation are the endpoints worth guessing at, so they carry the
// strictest budget in the system.
const limited = authRateLimit();

router.post('/login', limited, login);
router.post('/refresh', limited, refresh);
// Reachable while carrying `forcePasswordChange`, because it is the one thing
// such a user is supposed to do. See `requirePasswordChange`.
router.post('/change-password', requireAuth, changePassword);
router.post('/logout', requireAuth, logout);
router.post('/logout-all', requireAuth, logoutAll);
router.get('/sessions', requireAuth, listOwnSessions);
router.delete('/sessions/:id', requireAuth, revokeOwnSession);

export default router;

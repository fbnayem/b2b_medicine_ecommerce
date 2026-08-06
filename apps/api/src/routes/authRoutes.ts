import { Router } from 'express';
import {
  changePassword,
  listOwnSessions,
  login,
  logout,
  logoutAll,
  refresh,
  register,
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
/*
 * The only route in this application that creates records without a signed-in
 * actor, so it carries the same budget as sign-in rather than the ordinary write
 * budget. Without that, one script could fill the customer list and the
 * manager's terms queue with shops nobody asked for — which is the realistic
 * abuse of self-registration, not the credit exposure.
 */
router.post('/register', limited, register);
// Reachable while carrying `forcePasswordChange`, because it is the one thing
// such a user is supposed to do. See `requirePasswordChange`.
router.post('/change-password', requireAuth, changePassword);
router.post('/logout', requireAuth, logout);
router.post('/logout-all', requireAuth, logoutAll);
router.get('/sessions', requireAuth, listOwnSessions);
router.delete('/sessions/:id', requireAuth, revokeOwnSession);

export default router;

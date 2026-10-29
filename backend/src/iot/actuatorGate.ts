import type { OperatorTokenPayload } from '../auth/tokens.ts';

export interface ActuatorCommandRequest {
  action: 'LEFT' | 'RIGHT' | 'STOP' | 'CAPTURE';
}

export interface ActuatorGateResult {
  allowed: boolean;
  statusCode: number;
  error?: string;
  code?: string;
  commandChar?: string;
}

/**
 * Normalizes an actuator action string to single ASCII character expected by firmware:
 * - 'LEFT'    -> 'L'
 * - 'RIGHT'   -> 'R'
 * - 'STOP'    -> 'S'
 * - 'CAPTURE' -> 'C'
 */
export function normalizeActuatorCommand(action: unknown): string | null {
  if (typeof action !== 'string') return null;
  const upper = action.trim().toUpperCase();
  switch (upper) {
    case 'LEFT':
    case 'L':
      return 'L';
    case 'RIGHT':
    case 'R':
      return 'R';
    case 'STOP':
    case 'S':
      return 'S';
    case 'CAPTURE':
    case 'C':
      return 'C';
    default:
      return null;
  }
}

/**
 * Evaluates an actuator command request against authentication and the fail-closed safety gate.
 * NOTE: While actuators are disabled (enableActuators = false), this always returns HTTP 503
 * and dispatches zero commands, preventing unauthorized or accidental motor actuation.
 */
export function evaluateActuatorCommand(
  operator: OperatorTokenPayload | null,
  body: unknown,
  enableActuators: boolean
): ActuatorGateResult {
  // 1. Enforce authentication independently of actuator lockout
  if (!operator) {
    return {
      allowed: false,
      statusCode: 401,
      error: 'Authentication required for actuator commands',
      code: 'UNAUTHORIZED',
    };
  }

  // 2. Validate input schema
  if (typeof body !== 'object' || body === null) {
    return {
      allowed: false,
      statusCode: 400,
      error: 'Invalid request body. Expected JSON object with "action"',
      code: 'INVALID_BODY',
    };
  }

  const { action } = body as Record<string, unknown>;
  const commandChar = normalizeActuatorCommand(action);
  if (!commandChar) {
    return {
      allowed: false,
      statusCode: 400,
      error: 'Invalid action. Permitted actions: LEFT, RIGHT, STOP, CAPTURE',
      code: 'INVALID_ACTION',
    };
  }

  // 3. Enforce fail-closed safety gate
  if (!enableActuators) {
    return {
      allowed: false,
      statusCode: 503,
      error: 'Remote actuator control is disabled pending bench safety verification',
      code: 'ACTUATOR_DISABLED',
    };
  }

  // Actuation is not implemented in Gate A
  return {
    allowed: true,
    statusCode: 200,
    commandChar,
  };
}

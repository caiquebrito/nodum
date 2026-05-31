import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'test-secret';

export interface AuthToken {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export function generateToken(userId: string, email: string): string {
  return jwt.sign(
    { userId, email },
    SECRET,
    { expiresIn: '24h' }
  );
}

export function verifyToken(token: string): AuthToken | null {
  try {
    return jwt.verify(token, SECRET) as AuthToken;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  // Simplified for demo
  return Buffer.from(password).toString('base64');
}

export function validatePassword(plain: string, hashed: string): boolean {
  return hashPassword(plain) === hashed;
}

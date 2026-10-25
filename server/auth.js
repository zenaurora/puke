// 会话令牌与管理员会话
import crypto from 'node:crypto';

export function newToken() {
  return crypto.randomBytes(16).toString('hex');
}

export const ADMIN_KEY = 'max#33';

import crypto from 'crypto';

export const generateId = (prefix: string): string => {
  return `${prefix}-${crypto.randomUUID().split('-')[0]}-${Date.now().toString(36)}`;
};

export const hashPassword = async (password: string): Promise<string> => {
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  return hash;
};

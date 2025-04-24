import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

export const encodeToken = (payload: object) => {
  return jwt.sign(payload, process.env.SECRET_KEY as string);
};

export const decodeToken = (token: string) => {
  try {
    return jwt.verify(token, process.env.SECRET_KEY as string);
  } catch (error) {
    throw new Error('Token no válido');
  }
};

export const encryptPassword = (password: string) => {
  return jwt.sign({ password }, process.env.USER_KEY as string);
};

export const decryptPassword = (token: string) => {
  try {
    const decoded = jwt.verify(token, process.env.USER_KEY as string);
    return (decoded as any).password;
  } catch (error) {
    throw new Error('Token de contraseña no válido');
  }
};

export const jwtControllers = {
  encodeToken,
  decodeToken,
  encryptPassword,
  decryptPassword
};

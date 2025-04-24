import { getMockReq, getMockRes } from '@jest-mock/express';
import { prismaMock } from '../../singelton';
import { userControllers } from '../user_controllers';
import { sendVerificationEmail } from '../../utilities/emailVerification';

jest.fn(sendVerificationEmail);
jest.mock('../../utilities/passwordReset');
test("should mock Prisma client", () => {
  expect(prismaMock.user.findUnique).toBeDefined();
});
describe('userControllers.login', () => {
  it('debería autenticar a un usuario correctamente', async () => {
    // Crear request y response mockeados
    const req = getMockReq({
      body: { email: 'test@example.com', password: 'hashedPassword123' },
    });

    const { res, clearMockRes } = getMockRes();
    clearMockRes(); // Limpia los mocks si se reutiliza res

    // Configurar el mock de Prisma
    prismaMock.user.findUnique.mockResolvedValue({
      id: 1,
      name: 'Test',
      surname: 'User',
      email: 'test@example.com',
      password: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXNzd29yZCI6Imhhc2hlZFBhc3N3b3JkMTIzIiwiaWF0IjoxNzM0NzI3MTE0fQ.Zg5JsbgkBowUuk01q3wgqQGQDUXfz2oVfnepAEYSos4',
      phone: '123-456-7890',
      createdAt: new Date(),
      role: 'user',
      verificationToken: 'token123',
      verified: true,
    });

    // Mockear la desencriptación de contraseña

    // Llamar al controlador
    await userControllers.login(req, res, prismaMock);

    // Aserciones
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Usuario logueado' });
  });

  
});

describe('userControllers.register', () => {
  it('debería crear un usuario correctamente', async () => {
    //email, password, address, name, phone, role, surname
    // Crear request y response mockeados
    const req = getMockReq({
      body: { email: 'test@example.com', password: 'hashedPassword123', address:[], name:"Pepe", surname:"Sanchez",role:"user",phone:"312321312" },
    });

    const { res, clearMockRes } = getMockRes();
    clearMockRes(); // Limpia los mocks si se reutiliza res

    // Configurar el mock de Prisma
    prismaMock.user.create.mockResolvedValue({
      id: 1,
      name: 'Test',
      surname: 'User',
      email: 'test@example.com',
      password: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwYXNzd29yZCI6Imhhc2hlZFBhc3N3b3JkMTIzIiwiaWF0IjoxNzM0NzI3MTE0fQ.Zg5JsbgkBowUuk01q3wgqQGQDUXfz2oVfnepAEYSos4',
      phone: '123-456-7890',
      createdAt: new Date(),
      role: 'user',
      verificationToken: 'token123',
      verified: true,
    });
    

    // Mockear la desencriptación de contraseña

    // Llamar al controlador
    prismaMock.user.findUnique.mockReset()

    await userControllers.register(req, res, prismaMock);

    // Aserciones
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ message: "Usuario creado", user: 1, valid:true });
  });

  
});


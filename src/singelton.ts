import { mockDeep, DeepMockProxy } from "jest-mock-extended";
import prisma from "../src/client";

jest.mock("../src/client", () => ({
  __esModule: true,
  default: mockDeep(),
}));

export const prismaMock = prisma as unknown as DeepMockProxy<typeof prisma>;

import { Request, Response, Router } from "express";
import prisma from "../src/client";
import { vocabularioControllers } from "./controllers/vocabulario_controllers";

const router = Router();
router.get('/words', (req, res) => vocabularioControllers.listWords(req, res, prisma));
router.get('/words/:word', (req, res) => {vocabularioControllers.getOrCreateWord(req, res, prisma)});
router.post('/words', (req, res) => {vocabularioControllers.createWord(req, res, prisma)});
router.put('/words/:id', (req, res) => vocabularioControllers.updateWord(req, res, prisma));
router.delete('/words/:id', (req, res) => vocabularioControllers.deleteWord(req, res, prisma));


export default router;

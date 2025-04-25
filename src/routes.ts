import { Request, Response, Router } from "express";
import prisma from "../src/client";
import { vocabularioControllers } from "./controllers/vocabulario_controllers";

const router = Router();
router.get('/words', (req, res) => vocabularioControllers.listWords(req, res, ));
router.get('/words/:word', (req, res) => {vocabularioControllers.getOrCreateWord(req, res, )});
router.post('/words', (req, res) => {vocabularioControllers.createWord(req, res, )});
router.put('/words/:id', (req, res) => vocabularioControllers.updateWord(req, res, ));
router.delete('/words/:id', (req, res) => vocabularioControllers.deleteWord(req, res, ));
router.post('/words/suggestions', (req, res) => {vocabularioControllers.getSuggestions(req, res, )});

export default router;

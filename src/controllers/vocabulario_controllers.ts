import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

/**
 * Consulta la API externa y devuelve definición, tipo y sinónimos.
 */
const fetchFromDictionaryAPI = async (word: string) => {
    const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
    const data = response.data[0];
    return {
        definition: data.meanings[0].definitions[0].definition,
        type: data.meanings[0].partOfSpeech,
        synonyms: data.meanings[0].definitions[0].synonyms || []
    };
};

/**
 * Lista todas las palabras con opciones de orden y filtro.
 */
const listWords = async (req: Request, res: Response) => {
    const { sort } = req.query;

    try {
        let orderBy = {};
        if (sort === 'alphabetical') orderBy = { word: 'asc' };
        if (sort === 'type') orderBy = { type: 'asc' };
        if (sort === 'date') orderBy = { createdAt: 'desc' };

        const words = await prisma.word.findMany({
            orderBy,
            include: { apiSynonyms: true, assocSynonyms: true }
        });

        res.status(200).json({ valid: true, words });
    } catch (error) {
        res.status(500).json({ valid: false, message: "Error fetching words" });
    }
};

/**
 * Obtiene o crea una palabra, asociando sinónimos automáticamente.
 */
const getOrCreateWord = async (req: Request, res: Response) => {
    const { word } = req.params;

    try {
        const lowerWord = word.toLowerCase();

        let existingWord = await prisma.word.findUnique({
            where: { word: lowerWord },
            include: { apiSynonyms: true, assocSynonyms: true }
        });

        if (existingWord) {
            return res.status(200).json({ valid: true, word: existingWord });
        }

        return await createWordInternal(lowerWord, res);
    } catch (error) {
        res.status(500).json({ valid: false, message: (error as Error).message || "Error fetching word" });
    }
};

/**
 * Crea una palabra, guarda sinónimos de la API y asocia sinónimos automáticamente.
 */
const createWord = async (req: Request, res: Response) => {
    const { word } = req.body;

    if (!word) return res.status(400).json({ valid: false, message: "Word is required" });

    const lowerWord = word.toLowerCase();
    return await createWordInternal(lowerWord, res);
};

/**
 * Lógica interna de creación de palabra.
 */
const createWordInternal = async (lowerWord: string, res: Response) => {
    try {
        const existingWord = await prisma.word.findUnique({
            where: { word: lowerWord },
            include: { apiSynonyms: true, assocSynonyms: true }
        });

        if (existingWord) {
            return res.status(200).json({ valid: true, word: existingWord, message: "Word already exists" });
        }

        const { definition, type, synonyms } = await fetchFromDictionaryAPI(lowerWord);
        const apiSynonyms = synonyms.map((s: string) => s.toLowerCase());

        const newWord = await prisma.word.create({
            data: {
                word: lowerWord,
                type,
                definition
            }
        });

        for (const syn of apiSynonyms) {
            await prisma.apiSynonym.create({
                data: {
                    word: syn,
                    wordRefId: newWord.id
                }
            });
        }

        await checkAndAssociateSynonymsFromAPI(newWord, prisma);

        const wordWithSynonyms = await prisma.word.findUnique({
            where: { id: newWord.id },
            include: { apiSynonyms: true, assocSynonyms: true }
        });

        res.status(201).json({ valid: true, word: wordWithSynonyms, message: "Word created successfully" });
    } catch (error) {
        res.status(500).json({ valid: false, message: (error as Error).message || "Error creating word" });
    }
};

/**
 * Asociar sinónimos automáticos en base a sinónimos traídos por la API.
 */
const checkAndAssociateSynonymsFromAPI = async (newWord: any, prisma: PrismaClient) => {
    const apiSynonymsNew = await prisma.apiSynonym.findMany({
        where: { wordRefId: newWord.id }
    });
    const apiSynonymsNewList = apiSynonymsNew.map(s => s.word.toLowerCase());

    const allWords = await prisma.word.findMany();

    for (const existingWord of allWords) {
        if (existingWord.id === newWord.id) continue;

        const existingApiSynonyms = await prisma.apiSynonym.findMany({
            where: { wordRefId: existingWord.id }
        });
        const existingApiSynonymsList = existingApiSynonyms.map(s => s.word.toLowerCase());

        const hasMatch = 
            apiSynonymsNewList.includes(existingWord.word.toLowerCase()) ||
            existingApiSynonymsList.includes(newWord.word.toLowerCase()) ||
            apiSynonymsNewList.some(syn => existingApiSynonymsList.includes(syn));

        if (hasMatch) {
            const existingRelation = await prisma.associatedSynonym.findFirst({
                where: { word: existingWord.word, wordRefId: newWord.id }
            });

            if (!existingRelation) {
                await prisma.associatedSynonym.create({
                    data: { word: existingWord.word, wordRefId: newWord.id }
                });
            }

            const reverseRelation = await prisma.associatedSynonym.findFirst({
                where: { word: newWord.word, wordRefId: existingWord.id }
            });

            if (!reverseRelation) {
                await prisma.associatedSynonym.create({
                    data: { word: newWord.word, wordRefId: existingWord.id }
                });
            }
        }
    }
};

/**
 * Actualiza una palabra existente.
 */
const updateWord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { definition, type } = req.body;

    try {
        const updatedWord = await prisma.word.update({
            where: { id: parseInt(id) },
            data: { definition, type },
            include: { apiSynonyms: true, assocSynonyms: true }
        });

        res.status(200).json({ valid: true, word: updatedWord, message: "Word updated successfully" });
    } catch (error) {
        res.status(404).json({ valid: false, message: "Word not found" });
    }
};

/**
 * Elimina una palabra junto con sus sinónimos.
 */
const deleteWord = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await prisma.apiSynonym.deleteMany({ where: { wordRefId: parseInt(id) } });
        await prisma.associatedSynonym.deleteMany({ where: { wordRefId: parseInt(id) } });
        await prisma.word.delete({ where: { id: parseInt(id) } });

        res.status(200).json({ valid: true, message: "Word deleted successfully" });
    } catch (error) {
        res.status(404).json({ valid: false, message: "Word not found" });
    }
};

export const vocabularioControllers = {
    listWords,
    getOrCreateWord,
    createWord,
    updateWord,
    deleteWord
};
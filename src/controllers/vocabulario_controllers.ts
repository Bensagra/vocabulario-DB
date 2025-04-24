import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { Request, Response } from 'express';


import OpenAI from "openai";
const client = new OpenAI();
const prisma = new PrismaClient();

/**
 * Consulta la API externa y devuelve definición, tipo y sinónimos.
 */
const fetchFromDictionaryAPI = async (word:String) => {
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
 const listWords = async (req:Request, res:Response, prisma:PrismaClient) => {
    const { sort, filter } = req.query;

    try {
        let orderBy = {};
        if (sort === 'alphabetical') orderBy = { word: 'asc' };
        if (sort === 'type') orderBy = { type: 'asc' };
        if (sort === 'date') orderBy = { createdAt: 'desc' };

        let words;
        if (typeof filter === 'string' && filter.startsWith('sinonym:')) {
            const synonymSearch = filter.split(':')[1];
            words = await prisma.word.findMany({
                where: {
                    synonyms: { some: { word: synonymSearch } }
                },
                orderBy
            });
        } else {
            words = await prisma.word.findMany({ orderBy, include: { synonyms: true } });
        }

        res.status(200).json({ valid: true, words });
    } catch (error) {
        res.status(500).json({ valid: false, message: "Error fetching words" });
    }
};

/**
 * Obtiene o crea una palabra, asociando sinónimos automáticamente.
 */
 const getOrCreateWord = async (req:Request, res:Response, prisma:PrismaClient) => {
    const { word } = req.params;

    try {
        const lowerWord = word.toLowerCase();

        let existingWord = await prisma.word.findUnique({
            where: { word: lowerWord },
            include: { synonyms: true }
        });

        if (existingWord) {
            return res.status(200).json({ valid: true, word: existingWord });
        }

        const { definition, type, synonyms } = await fetchFromDictionaryAPI(lowerWord);

        const newWord = await prisma.word.create({
            data: {
                word: lowerWord,
                type,
                definition
            }
        });

        // Asociar sinónimos automáticamente
        for (const syn of synonyms) {
            const existingSynWord = await prisma.word.findUnique({
                where: { word: syn.toLowerCase() }
            });

            if (existingSynWord) {
                await prisma.synonym.create({
                    data: {
                        word: syn.toLowerCase(),
                        wordRefId: newWord.id
                    }
                });
            } else {
                await prisma.synonym.create({
                    data: {
                        word: syn.toLowerCase(),
                        wordRefId: newWord.id
                    }
                });
            }
        }

        const wordWithSynonyms = await prisma.word.findUnique({
            where: { id: newWord.id },
            include: { synonyms: true }
        });

        res.status(201).json({ valid: true, word: wordWithSynonyms, message: "Word fetched and saved" });
    } catch (error) {
        res.status(500).json({ valid: false, message: (error as Error).message || "Error fetching word" });
    }
};
const createWord = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { word } = req.body;

    if (!word) return res.status(400).json({ valid: false, message: "Word is required" });

    try {
        const lowerWord = word.toLowerCase();

        const existingWord = await prisma.word.findUnique({
            where: { word: lowerWord },
            include: { synonyms: true }
        });

        if (existingWord) {
            return res.status(200).json({ valid: true, word: existingWord, message: "Word already exists" });
        }

        const { definition, type, synonyms } = await fetchFromDictionaryAPI(lowerWord);

        const newWord = await prisma.word.create({
            data: {
                word: lowerWord,
                type,
                definition
            }
        });

        // Guardar sinónimos de la API externa
        for (const syn of synonyms) {
            await prisma.synonym.create({
                data: {
                    word: syn.toLowerCase(),
                    wordRefId: newWord.id
                }
            });
        }

        // Asociar sinónimos automáticos por definición similar
        await checkAndAssociateSynonymsAI(newWord, prisma);

        const wordWithSynonyms = await prisma.word.findUnique({
            where: { id: newWord.id },
            include: { synonyms: true }
        });

        res.status(201).json({ valid: true, word: wordWithSynonyms, message: "Word created successfully" });
    } catch (error) {
        res.status(500).json({ valid: false, message: (error as Error).message || "Error creating word" });
    }
};

/**
 * Actualiza una palabra existente.
 */
 const updateWord = async (req:Request, res:Response, prisma:PrismaClient) => {
    const { id } = req.params;
    const { definition, type } = req.body;

    try {
        const updatedWord = await prisma.word.update({
            where: { id: parseInt(id) },
            data: { definition, type },
            include: { synonyms: true }
        });

        res.status(200).json({ valid: true, word: updatedWord, message: "Word updated successfully" });
    } catch (error) {
        res.status(404).json({ valid: false, message: "Word not found" });
    }
};

/**
 * Elimina una palabra junto con sus sinónimos.
 */
 const deleteWord = async (req:Request, res:Response, prisma:PrismaClient) => {
    const { id } = req.params;

    try {
        await prisma.synonym.deleteMany({ where: { wordRefId: parseInt(id) } });
        await prisma.word.delete({ where: { id: parseInt(id) } });

        res.status(200).json({ valid: true, message: "Word deleted successfully" });
    } catch (error) {
        res.status(404).json({ valid: false, message: "Word not found" });
    }
};
const checkAndAssociateSynonymsAI = async (newWord:any, prisma: PrismaClient) => {
    const allWords = await prisma.word.findMany();

    for (const existingWord of allWords) {
        if (existingWord.id === newWord.id) continue;

        const areSynonyms = await compareDefinitionsWithAI(
            newWord.word,
            newWord.definition,
            existingWord.word,
            existingWord.definition
        );

        if (areSynonyms) {
            const existingRelation = await prisma.synonym.findFirst({
                where: { word: existingWord.word, wordRefId: newWord.id }
            });

            if (!existingRelation) {
                await prisma.synonym.create({
                    data: {
                        word: existingWord.word,
                        wordRefId: newWord.id
                    }
                });
            }

            const reverseRelation = await prisma.synonym.findFirst({
                where: { word: newWord.word, wordRefId: existingWord.id }
            });

            if (!reverseRelation) {
                await prisma.synonym.create({
                    data: {
                        word: newWord.word,
                        wordRefId: existingWord.id
                    }
                });
            }
        }
    }
};



/**
 * Compara dos definiciones usando GPT y determina si las palabras son sinónimos.
 */
const compareDefinitionsWithAI = async (wordA: string, defA: string, wordB: string, defB: string) => {
    const prompt = `
You are a language expert. Compare the meanings of the following two words based on their definitions.

Word 1: "${wordA}"
Definition 1: "${defA}"

Word 2: "${wordB}"
Definition 2: "${defB}"

Are these words synonyms? 
Respond ONLY with "YES" or "NO".
`;

    const response = await client.chat.completions.create({
        model: "gpt-4.1",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 3
    });

    const content = response.choices[0]?.message?.content;
    const reply = content ? content.trim().toUpperCase() : "";
    return reply === "YES";
};



export const vocabularioControllers = {
    listWords,
    getOrCreateWord,
    createWord,
    updateWord,
    deleteWord
}

import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { Request, Response } from 'express';
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const token = process.env["GITHUB_TOKEN"];
const endpoint = "https://models.github.ai/inference";
const model = "openai/gpt-4.1";
import OpenAI from "openai";
const client = new OpenAI();
const prisma = new PrismaClient();
const HF_TOKEN = process.env.HUGGINGFACE_API_KEY || "";
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
const checkAndAssociateSynonymsAI = async (newWord: any, prisma: PrismaClient) => {
    const allWords = await prisma.word.findMany();

    if (allWords.length === 0) return;

    // Armamos el listado de palabras existentes
    let wordList = "";
    allWords.forEach(word => {
        wordList += `- ${word.word}: "${word.definition}"\n`;
    });

    const prompt = `
You are a language expert.

Here is a NEW word and its definition:
Word: "${newWord.word}"
Definition: "${newWord.definition}"

Here is a list of EXISTING words with their definitions:
${wordList}

Task:
Identify which words from the list are synonyms, belong to the same word family, or have a related meaning to the NEW word.

Respond ONLY with a list of the related words, separated by commas. 
If none are related, respond with "NONE".
`;

    const client = ModelClient(endpoint, new AzureKeyCredential(token as string));

    const response = await client.path("/chat/completions").post({
        body: {
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: prompt }
            ],
            temperature: 0,
            top_p: 1.0,
            model: model
        }
    });

    if (isUnexpected(response)) {
        console.error("AI Error:", response.body.error);
        throw response.body.error;
    }

    const content = response.body.choices[0]?.message?.content;
    if (!content) throw new Error("Response content is null or undefined");

    const reply = content.trim().toUpperCase();

    if (reply === "NONE") return;

    // Procesar respuesta: Lista de palabras separadas por coma
    const relatedWords = reply.split(',').map(w => w.trim().toLowerCase());

    for (const related of relatedWords) {
        const existing = allWords.find(w => w.word.toLowerCase() === related);

        if (existing) {
            const alreadyExists = await prisma.synonym.findFirst({
                where: { word: existing.word, wordRefId: newWord.id }
            });

            if (!alreadyExists) {
                await prisma.synonym.create({
                    data: { word: existing.word, wordRefId: newWord.id }
                });
            }

            const reverseExists = await prisma.synonym.findFirst({
                where: { word: newWord.word, wordRefId: existing.id }
            });

            if (!reverseExists) {
                await prisma.synonym.create({
                    data: { word: newWord.word, wordRefId: existing.id }
                });
            }
        }
    }
};


/**
 * Compara dos definiciones usando GPT y determina si las palabras son sinónimos.
 */





/**
 * Compara dos definiciones usando Azure AI Inference (GitHub Models).
 * Devuelve true si las palabras son sinónimos.
 */



export const vocabularioControllers = {
    listWords,
    getOrCreateWord,
    createWord,
    updateWord,
    deleteWord
}

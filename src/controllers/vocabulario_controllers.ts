import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { Request, Response } from 'express';

const prisma = new PrismaClient();

/**
 * Consulta la API externa y devuelve definiciones, tipo y sinónimos.
 */
const fetchFromDictionaryAPI = async (word: string) => {
    try {
        const defResponse = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        const data = defResponse.data[0];

        const type = data.meanings[0].partOfSpeech;

        const definitions: string[] = [];
        data.meanings.forEach((meaning: any) => {
            meaning.definitions.forEach((def: any) => {
                definitions.push(def.definition);
            });
        });

        const synResponse = await axios.get(`https://api.datamuse.com/words?rel_syn=${word}`);
        const synonyms = synResponse.data.map((item: any) => item.word);

        return { definitions, type, synonyms };
    } catch (error) {
        console.error("Error fetching from dictionary APIs:", (error as Error).message);
        return { definitions: ["Definition not found."], type: "other", synonyms: [] };
    }
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
            include: { apiSynonyms: true, assocSynonyms: true, definitions: true }
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

        const existingWord = await prisma.word.findUnique({
            where: { word: lowerWord },
            include: { apiSynonyms: true, assocSynonyms: true, definitions: true }
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
            include: { apiSynonyms: true, assocSynonyms: true, definitions: true }
        });

        if (existingWord) {
            return res.status(200).json({ valid: true, word: existingWord, message: "Word already exists" });
        }

        const { definitions, type, synonyms } = await fetchFromDictionaryAPI(lowerWord);
        const apiSynonyms = synonyms.map((s: string) => s.toLowerCase());

        const newWord = await prisma.word.create({
            data: { word: lowerWord, type }
        });

        for (const def of definitions) {
            await prisma.definition.create({
                data: { text: def, wordId: newWord.id }
            });
        }

        for (const syn of apiSynonyms) {
            await prisma.apiSynonym.create({
                data: { word: syn, wordRefId: newWord.id }
            });
        }

        await checkAndAssociateSynonymsFromAPI(newWord, prisma);

        const wordWithSynonyms = await prisma.word.findUnique({
            where: { id: newWord.id },
            include: { apiSynonyms: true, assocSynonyms: true, definitions: true }
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
    const apiSynonymsNewList = (await prisma.apiSynonym.findMany({ where: { wordRefId: newWord.id } }))
        .map(s => s.word.toLowerCase());

    const allWords = await prisma.word.findMany();

    for (const existingWord of allWords) {
        if (existingWord.id === newWord.id) continue;

        const existingApiSynonymsList = (await prisma.apiSynonym.findMany({ where: { wordRefId: existingWord.id } }))
            .map(s => s.word.toLowerCase());

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
 * Actualiza una palabra existente (solo tipo). Las definiciones se gestionan aparte.
 */
const updateWord = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { type } = req.body;

    try {
        const updatedWord = await prisma.word.update({
            where: { id: parseInt(id) },
            data: { type },
            include: { apiSynonyms: true, assocSynonyms: true, definitions: true }
        });

        res.status(200).json({ valid: true, word: updatedWord, message: "Word updated successfully" });
    } catch (error) {
        res.status(404).json({ valid: false, message: "Word not found" });
    }
};

/**
 * Elimina una palabra junto con definiciones y sinónimos.
 */
const deleteWord = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await prisma.definition.deleteMany({ where: { wordId: parseInt(id) } });
        await prisma.apiSynonym.deleteMany({ where: { wordRefId: parseInt(id) } });
        await prisma.associatedSynonym.deleteMany({ where: { wordRefId: parseInt(id) } });
        await prisma.word.delete({ where: { id: parseInt(id) } });

        res.status(200).json({ valid: true, message: "Word deleted successfully" });
    } catch (error) {
        res.status(404).json({ valid: false, message: "Word not found" });
    }
};

const getSuggestions = async (req: Request, res: Response) => {
    const q = String(req.query.q ?? '').toLowerCase().trim();
    if (!q) {
      return res.status(400).json({ valid: false, message: 'Se requiere query' });
    }
  
    // 1) Encuentra palabras que contengan la query
    const matchedWords = await prisma.word.findMany({
      where: { word: { contains: q } },
      select: { id: true }
    });
  
    // 2) Encuentra sinónimos de API que contengan la query
    const matchedApiSyns = await prisma.apiSynonym.findMany({
      where: { word: { contains: q } },
      select: { wordRefId: true }
    });
  
    // 3) Encuentra sinónimos asociados que contengan la query
    const matchedAssocSyns = await prisma.associatedSynonym.findMany({
      where: { word: { contains: q } },
      select: { wordRefId: true }
    });
  
    // 4) Agrupa todos los IDs de palabras relevantes
    const wordIds = new Set<number>();
    matchedWords.forEach(w => wordIds.add(w.id));
    matchedApiSyns.forEach(s => wordIds.add(s.wordRefId));
    matchedAssocSyns.forEach(s => wordIds.add(s.wordRefId));
  
    if (wordIds.size === 0) {
      // No encontró nada
      return res.json({ valid: true, synonyms: [] });
    }
  
    // 5) Trae todos los sinónimos (API) de esas palabras
    const apiSynsAll = await prisma.apiSynonym.findMany({
      where: { wordRefId: { in: Array.from(wordIds) } },
      select: { word: true }
    });
  
    // 6) Trae todos los sinónimos (asociados) de esas palabras
    const assocSynsAll = await prisma.associatedSynonym.findMany({
      where: { wordRefId: { in: Array.from(wordIds) } },
      select: { word: true }
    });
  
    // 7) Reúne y unifica en un set para eliminar duplicados
    const synonymsSet = new Set<string>();
    apiSynsAll.forEach(s => synonymsSet.add(s.word));
    assocSynsAll.forEach(s => synonymsSet.add(s.word));
  
    // 8) Devuelve la lista ordenada
    const synonyms = Array.from(synonymsSet).sort();
  
    res.json({ valid: true, synonyms });
  };

export const vocabularioControllers = {
    listWords,
    getOrCreateWord,
    createWord,
    updateWord,
    deleteWord,
    getSuggestions
};
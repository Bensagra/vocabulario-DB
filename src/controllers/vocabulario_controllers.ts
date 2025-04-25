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
async function fetchFromDictionaryAPI2(word: string) {
    try {
      const defResponse = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
      const data = defResponse.data[0];
      const definitions: string[] = [];
      data.meanings.forEach((m: any) =>
        m.definitions.forEach((d: any) => definitions.push(d.definition))
      );
      return definitions;
    } catch {
      return ['Definition not found.'];
    }
  }

const getSuggestions = async (req: Request, res: Response) => {
    const q = String(req.query.q).toLowerCase().trim();
    if (!q) {
      return res.status(400).json({ valid: false, message: 'Se requiere query' });
    }
  
    // 1) IDs de palabras que contienen la query
    const matchedWords = await prisma.word.findMany({
      where: { word: { contains: q } },
      select: { id: true }
    });
    console.log('matchedWords', matchedWords);
  
    // 2) IDs de wordRefId de apiSynonym que contienen la query
    const matchedApiSyns = await prisma.apiSynonym.findMany({
      where: { word: { contains: q } },
      select: { wordRefId: true }
    });
  
    // 3) IDs de wordRefId de associatedSynonym que contienen la query
    const matchedAssocSyns = await prisma.associatedSynonym.findMany({
      where: { word: { contains: q } },
      select: { wordRefId: true }
    });
  
    // 4) Unir todos los IDs en un Set
    const wordIds = new Set<number>();
    matchedWords.forEach(w => wordIds.add(w.id));
    matchedApiSyns.forEach(s => wordIds.add(s.wordRefId));
    matchedAssocSyns.forEach(s => wordIds.add(s.wordRefId));
  
    if (wordIds.size === 0) {
      return res.json({ valid: true, suggestions: [] });
    }
  
    // 5) Recopilar todos los sinónimos (API y asociados) de esas palabras
    const [ apiSynsAll, assocSynsAll ] = await Promise.all([
      prisma.apiSynonym.findMany({
        where: { wordRefId: { in: Array.from(wordIds) } },
        select: { word: true }
      }),
      prisma.associatedSynonym.findMany({
        where: { wordRefId: { in: Array.from(wordIds) } },
        select: { word: true }
      })
    ]);
  
    // 6) Unificar y ordenar
    const synonymsSet = new Set<string>();
    apiSynsAll.forEach(s => synonymsSet.add(s.word));
    assocSynsAll.forEach(s => synonymsSet.add(s.word));
    const synonyms = Array.from(synonymsSet).sort();
  
    // 7) Para cada sinónimo, si está en Word (tiene definiciones en DB), úsalas;
    //    sino, haz fetch a la API y obtén definiciones al vuelo.
    const suggestions = await Promise.all(synonyms.map(async syn => {
      const wordEntry = await prisma.word.findUnique({
        where: { word: syn },
        include: { definitions: true }
      });
  
      if (wordEntry && wordEntry.definitions.length) {
        return {
          word: syn,
          definitions: wordEntry.definitions.map(d => d.text),
          source: 'db'
        };
      } else {
        const definitions = await fetchFromDictionaryAPI2(syn);
        return {
          word: syn,
          definitions,
          source: 'api'
        };
      }
    }));
  
    res.status(200).json({ valid: true, suggestions });
  };

export const vocabularioControllers = {
    listWords,
    getOrCreateWord,
    createWord,
    updateWord,
    deleteWord,
    getSuggestions
};
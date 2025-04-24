import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import multer from "multer";
import supabase from "../utilities/supabase";
const storage = multer.memoryStorage();
const upload = multer({ storage }).single("image");
const getFood = (res:Response, prisma:PrismaClient) => {
    prisma.food_category.findMany({
        orderBy:{
            createdAt:"asc"
        },
        omit:{
            createdAt: true,
            modifyAt: true
        },
        include: {
            food: {orderBy:{createdAt:"asc"},where:{deleted:false},omit: {createdAt: true, modifyAt: true,}}
        }
    }).then((data) => {
        res.status(200).json({valid:true, data});
        return
    }).catch((error) => {
        res.status(500).json({valid:false, message: "Error getting food",data: error});
        return
    })
}

const modifyFood = async (req: Request, res: Response, prisma: PrismaClient) => {
    upload(req, res, async (err) => {

    const { id, description, price, name, categoryId } = req.body;
    console.log(req.body.id);

    const imageFile = req.file; // Capturar la imagen si fue enviada

    try {
        // Obtener la comida actual para mantener los valores no enviados
        const existingFood = await prisma.food.findUnique({ where: { id: parseInt(id) } });
        if (!existingFood) {
             res.status(404).json({ valid: false, message: "Food not found" });
             return
        }

        let imageUrl = existingFood.image; // Mantener la imagen anterior por defecto

        // Si se subió una nueva imagen, la subimos a Supabase
        if (imageFile) {
            const fileName = `${Date.now()}-${imageFile.originalname}`;
            const { data, error } = await supabase.storage
                .from("images")
                .upload(fileName, imageFile.buffer, {
                    contentType: imageFile.mimetype,
                });

            if (error) throw error;
            imageUrl = `https://vljaisdvadywiyqrvryd.supabase.co/storage/v1/object/public/images/${fileName}`;
        }

        // Actualizar solo los valores enviados en la request
        let updatedFood = await prisma.food.update({
            where: { id: parseInt(id) },
            data: {
                description: description ?? existingFood.description,
                price: parseFloat(price) ?? existingFood.price,
                categoryId: parseFloat(categoryId) ?? existingFood.categoryId,
                image: imageUrl, // Se mantiene la anterior si no se subió una nueva
                modifyAt: new Date(),
                name: name ?? existingFood.name,
            },
        });

        res.status(200).json({ valid: true, message: "Food updated successfully", data: updatedFood });
    } catch (error) {
        res.status(500).json({ valid: false, message: "Error updating food", data: id,description,price,name,imageFile });
    }
});
};



const createFood = async (req: Request, res: Response, prisma: PrismaClient) => {
    upload(req, res, async (err) => {
        if (err) {
            return res.status(400).json({ valid: false, message: "Error uploading file", data: err });
        }

        const { description, price, name, categoryId } = req.body;
        if (!req.file) {
            return res.status(400).json({ valid: false, message: "Image file is required" });
        }

        try {
            // Subir imagen a Supabase Storage
            const fileBuffer = req.file.buffer;
            const fileName = `${Date.now()}-${req.file.originalname}`;
            const bucketName = "images"; // Reemplaza con el nombre del bucket en Supabase

            const { data: uploadData, error: uploadError } = await supabase
                .storage
                .from(bucketName)
                .upload(fileName, fileBuffer, {
                    contentType: req.file.mimetype,
                });

            if (uploadError) throw uploadError;

            // Obtener URL pública de la imagen
            const { data: publicURL } = supabase.storage.from(bucketName).getPublicUrl(fileName);
            if (!publicURL) throw new Error("Could not get public URL");
                console.log(publicURL.publicUrl);
            // Guardar en la base de datos
            const food = await prisma.food.create({
                data: { description, price:parseFloat(price), image: publicURL.publicUrl, name, categoryId:parseFloat(categoryId),}
            });

            res.status(200).json({ valid: true, message: "Food created successfully", data: food });
        } catch (error) {
            res.status(500).json({ valid: false, message: "Error creating food", data: error });
        }
    });
};

const deleteFood = async (req: Request, res: Response, prisma: PrismaClient) => {
    const id = parseInt(req.query.id as string);
    console.log(id);

    try {
        const food = await prisma.food.update({ where: { id }, data: { deleted: true } });
        res.status(200).json({ valid: true, message: "Food deleted successfully", data: food });
    } catch (error) {
        res.status(500).json({ valid: false, message: "Error deleting food", data: error });
    }
};

const updateStock = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { id } = req.body;
    try {
        const stock = await prisma.food.findUnique({ where: { id } });
        const food = await prisma.food.update({ where: { id }, data: { stock: !(stock!.stock)} });
        res.status(200).json({ valid: true, message: "Stock updated successfully", data: food });
    }
    catch (error) {
        res.status(500).json({ valid: false, message: "Error updating stock", data: error });
    }
}

export const foodControllers = {
    getFood,
    modifyFood,
    createFood,
    deleteFood,
    updateStock
}
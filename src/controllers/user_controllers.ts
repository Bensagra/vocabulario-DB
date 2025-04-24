import { PrismaClient } from "@prisma/client"
import { Request, Response } from "express"
import { decryptPassword, encryptPassword } from "../utilities/jwt";

const register = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { email, password, name, surname,phone } = req.body;
    console.log(email, password, name, surname, phone);
    try {
        const user = await prisma.user.create({
            data: {
                email:email.toLowerCase(),
                password:encryptPassword(password), 
                name,
                surname,
                phone
            }
        });
        res.status(200).json({valid:true, user, message: "User created successfully"});
    } catch (error) {
        res.status(500).json({valid:false, message: "Error creating user"});
    }
}

const login = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { email, password } = req.body;
    try {
        const user = await prisma.user.findUnique({
            where: {
                email: email.toLowerCase(),
            }
        });
        if(user){
            if (password !== decryptPassword(user.password)) {
                res.status(401).json({valid:false, message: "Invalid password"});
                return;
                
            }
            res.status(200).json({valid:true, user, message: "User logged in successfully"});
        }else{
            res.status(401).json({valid:false, message: "User not found"});
        }
    } catch (error) {
        res.status(500).json({valid:false, message: "Error logging in"});
    }
}


const blockUser = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { id } = req.body;
    try {
        const user = await prisma.user.update({
            where: { id },
            data: { blocked: true }
        });
        res.status(200).json({ valid: true, user, message: "User blocked successfully" });
    } catch (error) {
        res.status(500).json({ valid: false, message: "Error blocking user" });
    }
}








export const userControllers = {
    register,
    login,
    blockUser
}

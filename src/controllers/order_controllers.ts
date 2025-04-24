import { PrismaClient } from "@prisma/client";
import { Request, Response } from "express";
import { endOfDay, startOfDay } from "date-fns";
import { get } from "http";

const createOrder = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { order, hour, userId, notes,local } = req.body;

    try {
        if(await prisma.user.findUnique({where:{id:parseInt(userId),blocked:true}})!=null){
            res.status(400).json({valid:false, message: "User is blocked"});
            return;
        }
        const foodPrices = await prisma.food.findMany({
            where: {
                id: { in: order.map((food: { id: any }) => parseInt(food.id)) }
            },
            select: {
                id: true,
                price: true
            }
        });

        const priceMap = new Map(foodPrices.map(food => [food.id, food.price]));

        let totalPrice = order.reduce((sum: number, food: { id: any; quantity: any }) => {
            return sum + (priceMap.get(food.id) || 0) * food.quantity;
        }, 0);

        // Transacción para garantizar exclusividad
        const newOrder = await prisma.$transaction(async (tx) => {
            // Bloquea la fila del contador y obtiene el último número
            const counter = await tx.orderCounter.update({
                where: { id: 1 },
                data: { number: { increment: 1 } },
                select: { number: true }
            });

            const newNumber = (counter.number % 100) || 1;

            return await tx.pedido.create({
                data: {
                    local,
                    number: newNumber,
                    hour,
                    total: totalPrice,
                    userId:parseInt(userId),
                    notes: notes || null,
                    status: "PENDING",
                    food_pedido: {
                        create: order.map((food: { id: any; quantity: any }) => ({
                            quantity: food.quantity,
                            foodId: food.id,
                            price: priceMap.get(food.id) || 0  
                        }))
                    }
                }
            });
        });

        res.status(200).json({ valid: true, order, message: "Order created successfully", data: newOrder.number });
        return
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error creating order", data: error });
        return
    }
};

const orderConfirmation = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { orderId, status, userId } = req.body;

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId, role: "ADMIN" }
        });
        if (!user) {
            res.status(404).json({ valid: false, message: "User is not admin" });
            return
            
        }
        const order = await prisma.pedido.update({
            where: { id: orderId },
            data: { status: status }
        });

         res.status(200).json({ valid: true, message: "Order status changed successfully", data: order });
         return
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error confirming order", data: error });
        return
    }
}

const showOrders = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { userId } = req.body;
    const todayStart = startOfDay(new Date()); // Primer momento del día
  const todayEnd = endOfDay(new Date()); // Último momento del día

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId, role: "ADMIN" }
        });
        if (!user) {
            res.status(404).json({ valid: false, message: "User is not admin" });
            return
        }
        const orders = await prisma.pedido.findMany({
            where: { status: "PENDING"
                ,OR: [
                    {
                        createdAt: {
                            gte: todayStart,
                            lte: todayEnd
                        }
                    },
                    {
                        hour: {
                            gte: todayStart,
                            lte: todayEnd
                        }
                    }
                ]},
            include: {
                user: {
                    omit:{
                        createdAt: true,
                        modifyAt: true,
                        password: true,
                        blocked: true,
                        role: true,

                    }
                },
                food_pedido: {
                    omit:{
                        createdAt: true,
                        modifyAt: true,
                        
                        id: true
                    },
                    include: {
                        food: {omit:{
                            createdAt: true,
                            modifyAt: true,

                        }}
                    }
                }
            }
        });

        res.status(200).json({ valid: true, message: "Orders retrieved successfully", data: orders });
        return
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error retrieving orders", data: error });
        return
    }
}

const showOrdersConfirmed = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { userId } = req.body;
    const todayStart = startOfDay(new Date()); // Primer momento del día
  const todayEnd = endOfDay(new Date()); // Último momento del día

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId, role: "ADMIN" }
        });
        if (!user) {
            res.status(404).json({ valid: false, message: "User is not admin" });
            return
        }
        const orders = await prisma.pedido.findMany({
            where: { status: "CONFIRMED"
                ,OR: [
                    {
                        createdAt: {
                            gte: todayStart,
                            lte: todayEnd
                        }
                    },
                    {
                        hour: {
                            gte: todayStart,
                            lte: todayEnd
                        }
                    }
                ]},
            include: {
                user: {
                    omit:{
                        createdAt: true,
                        modifyAt: true,
                        password: true,
                        blocked: true,
                        role: true,

                    }
                },
                food_pedido: {
                    omit:{
                        createdAt: true,
                        modifyAt: true,
                        
                        id: true
                    },
                    include: {
                        food: {omit:{
                            createdAt: true,
                            modifyAt: true,

                        }}
                    }
                }
            }
        });

        res.status(200).json({ valid: true, message: "Orders retrieved successfully", data: orders });
        return
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error retrieving orders", data: error });
        return
    }
}

const showOrdersFromUser = async (req: Request, res: Response, prisma: PrismaClient) => {
    const { userId } = req.body;
    const todayStart = startOfDay(new Date());
    const todayEnd = endOfDay(new Date());

    try {
        const user = await prisma.user.findMany({
            where: { id: parseInt(userId), blocked: false, pedido: { some: { hour: { gte: todayStart, lte: todayEnd } } } }
        });
        if (!user) {
            res.status(404).json({ valid: false, message: "User is not user" });
            return
        }
        const orders = await prisma.pedido.findMany({
            where: {
                status: {
                    not: "DELIVERED"
                },
                userId: parseInt(userId),
                OR: [
                    {
                        createdAt: {
                            gte: todayStart,
                            lte: todayEnd
                        }
                    },
                    {
                        hour: {
                            gte: todayStart,
                            lte: todayEnd
                        }
                    }
                ]
            },
            orderBy: { hour: "desc" },

            include: {
                user: {
                    omit:{
                        createdAt: true,
                        modifyAt: true,
                        password: true,
                        blocked: true,
                        role: true,

                    }
                },
                food_pedido: {
                    omit:{
                        createdAt: true,
                        modifyAt: true,
                        
                        id: true
                    },
                    include: {
                        food: {omit:{
                            createdAt: true,
                            modifyAt: true,

                        }}
                    }
                }
            }
        });

        res.status(200).json({ valid: true, message: "Orders retrieved successfully", data: orders });
        return
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error retrieving orders", data: error });
        return
    }
}

const getBalance = async (req: Request, res: Response, prisma: PrismaClient) => {
    // Calcula la fecha de hace 7 días
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  
    prisma.pedido.findMany({
      where: { 
        status: "DELIVERED", 
        hour: { 
          lte: new Date(),
          gte: sevenDaysAgo
        } 
      },
      select: { total: true, hour: true }
    })
    .then((data) => {
      // Agrupa los pedidos por día (formateado como "YYYY-MM-DD")
      const grouped = data.reduce((acc, order) => {
        const day = new Date(order.hour).toISOString().slice(0, 10);
        if (!acc[day]) {
          acc[day] = { quantity: 0, balance: 0 };
        }
        acc[day].quantity++;
        acc[day].balance += order.total;
        return acc;
      }, {} as Record<string, { quantity: number, balance: number }>);
  
      // Transforma el objeto agrupado en un array de objetos
      const result = Object.entries(grouped).map(([day, stats]) => ({
        day,
        ...stats
      }));
  
      res.status(200).json({ valid: true, data: result });
    })
    .catch((error) => {
      res.status(500).json({ valid: false, message: "Error getting balance", data: error });
    });
  }


  const updateOrder = async (req: Request, res: Response, prisma: PrismaClient) => {
    // Se esperan en el body: orderId, order (array de items), hour, userId, notes y status
    const { orderId, order, hour, userId, notes, status, local} = req.body;

    try {
        // Verificar si el usuario está bloqueado
        if (!await prisma.user.findUnique({ where: { id: parseInt(userId), role:"ADMIN"} })) {
            res.status(400).json({ valid: false, message: "User is not admin" });
            return;
        }

        // Buscar el pedido a actualizar
        const existingOrder = await prisma.pedido.findUnique({
            where: { id: orderId },
            include: { food_pedido: true }
        });

        if (!existingOrder) {
            res.status(404).json({ valid: false, message: "Order not found" });
            return;
        }

        // Construir el objeto con los datos a actualizar
        const updateData: any = {};
        if (hour !== undefined) updateData.hour = hour;
        if (notes !== undefined) updateData.notes = notes;
        if (status !== undefined) updateData.status = status;
        if (userId !== undefined) updateData.userId = parseInt(userId);

        // Si se envían nuevos items para el pedido, actualizamos también la relación y recalculamos el total
        if (order) {
            // Obtener los precios actualizados de los alimentos incluidos en el nuevo pedido
            const foodPrices = await prisma.food.findMany({
                where: {
                    id: {
                        in: order.map((food: { id: any }) => parseInt(food.id))
                    }
                },
                select: {
                    id: true,
                    price: true
                }
            });

            const priceMap = new Map(foodPrices.map(food => [food.id, food.price]));

            // Calcular el total en base a los nuevos items
            const totalPrice = order.reduce((sum: number, food: { id: any, quantity: number }) => {
                return sum + (priceMap.get(parseInt(food.id)) || 0) * food.quantity;
            }, 0);
            updateData.total = totalPrice;

            // Para simplificar, se eliminan todos los items previos y se crean los nuevos
            await prisma.food_pedido.deleteMany({ where: { pedidoId: orderId } });
            const newOrderItems = order.map((food: { id: any, quantity: number }) => ({
                pedidoId: orderId,
                foodId: parseInt(food.id),
                quantity: food.quantity,
                price: priceMap.get(parseInt(food.id)) || 0,
                local: local
            }));

            await prisma.food_pedido.createMany({ data: newOrderItems });
        }

        // Actualizar el pedido principal
        const updatedOrder = await prisma.pedido.update({
            where: { id: orderId },
            data: updateData
        });

        res.status(200).json({ valid: true, message: "Order updated successfully", data: updatedOrder });
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error updating order", data: error });
    }
};


const getOrder = async (req: Request, res: Response, prisma: PrismaClient) => {
    // Se espera el id del pedido en los parámetros de la URL
    const orderId = req.query.id as string;  
    console.log(orderId);

    try {
        // Buscar el pedido
        const order = await prisma.pedido.findUnique({
            where: { id: orderId },
            include: {
                user: true,
                food_pedido: {
                    include: {
                        food: true
                    }
                }
            }
        });

        if (!order) {
            res.status(404).json({ valid: false, message: "Order not found" });
            return;
        }

        res.status(200).json({ valid: true, message: "Order retrieved successfully", data: order });
    } catch (error) {
        console.error(error);
        res.status(500).json({ valid: false, message: "Error retrieving order", data: error });
    }
}

 



export const orderControllers = {
    showOrdersFromUser,
    updateOrder,
    createOrder,
    orderConfirmation,
    showOrders,
    showOrdersConfirmed,
    getBalance,
    getOrder
}
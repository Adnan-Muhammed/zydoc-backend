import express from "express";
import { MongoUserRepository } from "../../infrastructure/repositories/MongoUserRepository.js";
import { GetPublicDoctors } from "../../application/usecases/doctor/GetPublicDoctors.js";
import { GetPublicDoctorById } from "../../application/usecases/doctor/GetPublicDoctorById.js";
import { DoctorsPublicController } from "../controllers/DoctorsPublicController.js";

const router = express.Router();

// Dependency Injection (Composition Root for Public Doctors Module)
const userRepository = new MongoUserRepository();
const getPublicDoctorsUseCase = new GetPublicDoctors(userRepository);
const getPublicDoctorByIdUseCase = new GetPublicDoctorById(userRepository);

const doctorsPublicController = new DoctorsPublicController(
  getPublicDoctorsUseCase,
  getPublicDoctorByIdUseCase
);

// Endpoints 

const test = (req,res,next)=>{
  console.log('its route ');
  next()
}
router.get("/", test,(req, res) => doctorsPublicController.getDoctors(req, res));
router.get("/:id", (req, res) => doctorsPublicController.getDoctorById(req, res));

export default router;

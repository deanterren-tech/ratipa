import { getDatabase, ref, get, set, update } from "firebase/database";
import { initializeApp } from "firebase/app";

// Assuming we have the config from .env or we can just read it from firebase.ts
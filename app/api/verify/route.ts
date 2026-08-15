import { initializeApp, getApps } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { NextResponse } from "next/server";
import config from "../../../firebase-applet-config.json";

const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
const db = getFirestore(app, config.firestoreDatabaseId);

export async function GET() {
  try {
    const ref = doc(db, "test", "connection");
    await getDoc(ref);
    return NextResponse.json({ status: "success", message: "Conexão com o banco de dados (Firestore) estabelecida com sucesso!" });
  } catch (error: any) {
    return NextResponse.json({ status: "error", message: error.message }, { status: 500 });
  }
}

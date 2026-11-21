// API articles et pages des partis — CitoyenCloud Maroc (hébergée sur Render)
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Clé de compte de service Firebase, stockée en variable d'environnement Render (JSON complet)
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// Listes séparées par des virgules (variables d'environnement Render)
const liste = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);
const ORIGINS = liste(process.env.ALLOWED_ORIGIN); // ex. https://site.azurewebsites.net,http://localhost:5173
const ADMINS = liste(process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL).map((e) => e.toLowerCase());

const app = express();
app.use(express.json());

// CORS : seules les adresses du site sont acceptées (contrat d'API de l'équipe)
app.use(
  cors({
    origin: ORIGINS,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
  })
);

// Journal : une ligne JSON par requête sur stdout (visible dans l'onglet Logs de Render)
app.use((req, _res, next) => {
  console.log(JSON.stringify({ t: new Date().toISOString(), method: req.method, path: req.path }));
  next();
});

// Vérification du jeton Firebase + liste d'administrateurs pour toute écriture
async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Jeton manquant" });
  try {
    req.user = await admin.auth().verifyIdToken(token);
  } catch (e) {
    console.warn("Jeton invalide :", e.code);
    return res.status(401).json({ error: "Jeton invalide" });
  }
  // Un jeton valide prouve seulement un compte Firebase : on vérifie aussi l'e-mail
  const email = (req.user.email || "").toLowerCase();
  if (ADMINS.length && !ADMINS.includes(email)) {
    return res.status(403).json({ error: "Accès réservé à l'administrateur" });
  }
  next();
}

app.get("/health", (_req, res) => res.json({ status: "ok", service: "api-articles" }));

// Générateur de routes CRUD pour une collection Firestore
function crud(path, collection) {
  app.get(`/${path}`, async (_req, res) => {
    const snap = await db.collection(collection).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });

  app.get(`/${path}/:id`, async (req, res) => {
    const doc = await db.collection(collection).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: "Introuvable" });
    res.json({ id: doc.id, ...doc.data() });
  });

  app.post(`/${path}`, requireAdmin, async (req, res) => {
    const ref = await db.collection(collection).add({ ...req.body, createdAt: new Date().toISOString() });
    res.status(201).json({ id: ref.id });
  });

  app.put(`/${path}/:id`, requireAdmin, async (req, res) => {
    await db.collection(collection).doc(req.params.id).set(req.body, { merge: true });
    res.json({ id: req.params.id });
  });

  app.delete(`/${path}/:id`, requireAdmin, async (req, res) => {
    await db.collection(collection).doc(req.params.id).delete();
    res.status(204).end();
  });
}

crud("articles", "articles");
crud("partis", "partis");

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`API articles à l'écoute sur ${port}`));

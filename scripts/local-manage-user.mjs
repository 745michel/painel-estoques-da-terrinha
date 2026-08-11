// Ferramenta LOCAL (nao roda no GitHub Actions) para criar/atualizar um usuario do painel.
// Uso: node scripts/local-manage-user.mjs email@daterrinhaalimentos.com.br "senhaTemporaria123" true
//   (o ultimo argumento eh acessoValores: true libera a aba financeira, false so operacional)
// Requer work/firebase-service-account.json (gitignored, nunca comitar).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [, , email, senha, acessoValoresArg] = process.argv;

if (!email || !senha) {
  console.error('Uso: node scripts/local-manage-user.mjs email senha [true|false]');
  process.exit(1);
}
const acessoValores = acessoValoresArg === "true";

const serviceAccount = JSON.parse(fs.readFileSync(path.join(root, "work", "firebase-service-account.json"), "utf8"));
initializeApp({
  credential: cert(serviceAccount),
  databaseURL: "https://painel-estoques-terrinha-default-rtdb.firebaseio.com",
});

const auth = getAuth();
const db = getDatabase();

let user;
try {
  user = await auth.getUserByEmail(email);
  await auth.updateUser(user.uid, { password: senha });
  console.log(`Usuario existente atualizado: ${email} (uid ${user.uid})`);
} catch {
  user = await auth.createUser({ email, password: senha });
  console.log(`Usuario criado: ${email} (uid ${user.uid})`);
}

await db.ref(`usuarios/${user.uid}`).set({ email, acessoValores });
console.log(`Permissao definida: acessoValores=${acessoValores}`);

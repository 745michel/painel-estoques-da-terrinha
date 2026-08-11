import { signIn } from "../../auth";

export default function LoginPage() {
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        background: "#f5f4f2",
      }}
    >
      <div
        style={{
          background: "#fff",
          padding: "48px 40px",
          borderRadius: 16,
          boxShadow: "0 2px 24px rgba(0,0,0,0.08)",
          textAlign: "center",
          maxWidth: 360,
        }}
      >
        <img src="/logo-da-terrinha.webp" alt="Da Terrinha Alimentos" style={{ height: 48, marginBottom: 24 }} />
        <h1 style={{ fontSize: 20, marginBottom: 8 }}>Controle de Estoques</h1>
        <p style={{ color: "#666", marginBottom: 32, fontSize: 14 }}>
          Entre com sua conta Microsoft da empresa para acessar o painel.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            style={{
              background: "#2f6f4f",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 24px",
              fontSize: 15,
              cursor: "pointer",
              width: "100%",
            }}
          >
            Entrar com Microsoft
          </button>
        </form>
      </div>
    </main>
  );
}

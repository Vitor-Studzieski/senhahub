export default function manifest() {
  return {
    id: "/",
    name: "SenhaHub - Supermercado Pompeia",
    short_name: "SenhaHub",
    description: "Fila virtual e acompanhamento de atendimento do Supermercado Pompeia.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#F3F3F3",
    theme_color: "#FF7200",
    lang: "pt-BR",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icons/senhahub-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/senhahub-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icons/senhahub-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/senhahub-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ],
    shortcuts: [
      {
        name: "Minhas senhas",
        short_name: "Senhas",
        description: "Abrir o acompanhamento das suas senhas.",
        url: "/?view=status",
        icons: [
          {
            src: "/icons/senhahub-192.png",
            sizes: "192x192",
            type: "image/png"
          }
        ]
      }
    ]
  };
}

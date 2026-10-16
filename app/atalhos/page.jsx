export const metadata = {
  title: "Central de atalhos",
  description: "Acesso rápido às páginas do SenhaHub do Supermercado Pompeia."
};

const shortcutGroups = [
  {
    title: "Conta",
    description: "Acesso e manutenção da conta.",
    links: [
      { label: "Acesso e senha", detail: "Entrar, criar conta ou alterar senha", href: "/login" }
    ]
  },
  {
    title: "Cliente",
    description: "Fila digital e acompanhamento das suas senhas.",
    links: [
      { label: "Fila e emissão de senha", detail: "Página principal do cliente", href: "/" },
      { label: "Minhas senhas", detail: "Acompanhar senhas ativas", href: "/?view=status" },
      { label: "Instalar aplicativo", detail: "Instruções para celular e computador", href: "/instalar" }
    ]
  },
  {
    title: "Atendimento",
    description: "Telas usadas nos balcões e nos pontos de atendimento.",
    links: [
      { label: "Painel do atendente", detail: "Chamadas e controle da fila", href: "/attendant" },
      { label: "Tablet de atendimento", detail: "Emissão de senhas no tablet", href: "/tablet" },
      { label: "Totem de senhas", detail: "Emissão de senhas físicas", href: "/totem" },
      { label: "TV do açougue", detail: "Chamadas e conteúdo exibido na loja", href: "/tv/acougue" }
    ]
  },
  {
    title: "Gestão",
    description: "Configurações, operação, setores e usuários.",
    links: [
      { label: "Visão geral", detail: "Indicadores e panorama da operação", href: "/admin" },
      { label: "Operação", detail: "Filas e atendimentos em andamento", href: "/admin/operacao" },
      { label: "Setores", detail: "Configurar setores de atendimento", href: "/admin/setores" },
      { label: "Totens e impressão", detail: "Gerenciar equipamentos e impressão", href: "/admin/totens" },
      { label: "Usuários", detail: "Contas e permissões do sistema", href: "/admin/usuarios" }
    ]
  },
  {
    title: "Conteúdo da loja",
    description: "Gerencie o material exibido nas TVs.",
    links: [
      { label: "Conteúdos da TV", detail: "Vídeos e imagens da loja", href: "/marketing/conteudos-tv" }
    ]
  }
];

export default function ShortcutsPage() {
  return (
    <main className="account-shortcuts">
      <div className="account-shortcuts__container">
        <header className="account-shortcuts__header">
          <img
            className="account-shortcuts__logo"
            src="/assets/senhahub-logo.png"
            alt="SenhaHub"
            width="220"
            height="74"
          />
          <a className="account-shortcuts__home" href="/">
            Área do cliente <span aria-hidden="true">→</span>
          </a>
        </header>

        <section className="account-shortcuts__intro" aria-labelledby="shortcutsTitle">
          <span className="account-shortcuts__eyebrow">Acesso exclusivo</span>
          <h1 id="shortcutsTitle">Central de atalhos</h1>
          <p>Abra as páginas do SenhaHub em um só lugar.</p>
          <span className="account-shortcuts__account">vitorstudzieski@superpompeia.com</span>
        </section>

        <div className="account-shortcuts__groups">
          {shortcutGroups.map((group, groupIndex) => (
            <section className="account-shortcuts__group" key={group.title} aria-label={group.title}>
              <div className="account-shortcuts__group-heading">
                <div>
                  <h2>{group.title}</h2>
                  <p>{group.description}</p>
                </div>
                <span aria-hidden="true">{String(groupIndex + 1).padStart(2, "0")}</span>
              </div>
              <div className="account-shortcuts__links">
                {group.links.map((link) => (
                  <a className="account-shortcuts__link" href={link.href} key={link.href}>
                    <span className="account-shortcuts__link-copy">
                      <strong>{link.label}</strong>
                      <small>{link.detail}</small>
                    </span>
                    <span className="account-shortcuts__arrow" aria-hidden="true">→</span>
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="account-shortcuts__note">
          As páginas mantêm as permissões atuais da conta. O acompanhamento por QR Code abre pelo link individual gerado para cada senha.
        </p>
      </div>
    </main>
  );
}

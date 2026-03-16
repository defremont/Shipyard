import json, datetime

filepath = "C:/Users/andre/AppData/Roaming/shipyard/data/tasks/canoe-claudio.json"

with open(filepath, "r", encoding="utf-8") as f:
    data = json.load(f)

tasks = data.get("tasks", [])

# Remove any leftover todo tasks from previous attempts
tasks = [t for t in tasks if t.get("status") != "todo"]

max_order = max(t.get("order", 0) for t in tasks) if tasks else -1
max_number = max(t.get("number", 0) for t in tasks) if tasks else 0

now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z")

new_tasks = [
    {"title": "Bug URGENTE: erro no pagamento ao reservar (#28/#29)", "description": "Erro ao tentar realizar pagamento/reserva. Botao cortado na web.", "prompt": "1) create-stripe-checkout edge function. 2) useBooking erros. 3) Stripe live keys. 4) CSS overflow botao.", "priority": "urgent", "status": "todo"},
    {"title": "Bug URGENTE: calendario fechado permite reserva (#34)", "description": "Dias fechados no calendario ainda permitem reservas. Bloquear frontend e backend.", "prompt": "1) blocked_dates storage. 2) useAvailability filtra blocked. 3) DatePicker. 4) Validacao server-side create-stripe-checkout.", "priority": "urgent", "status": "todo"},
    {"title": "Bug: Datas e Precos nao atualiza na reserva (#30)", "description": "Preco alterado em Datas e Precos nao reflete no checkout. So funciona via Editar.", "prompt": "1) DatesAndPrices salva onde. 2) Checkout le de onde. 3) Invalidar cache React Query.", "priority": "high", "status": "todo"},
    {"title": "Bug: redirect pos-login vai pra home (#30)", "description": "Apos login, usuario vai pra home em vez de voltar ao checkout onde estava.", "prompt": "1) sessionStorage returnUrl. 2) AuthProvider redirect. 3) ProtectedRoute.", "priority": "high", "status": "todo"},
    {"title": "Bug: pagamento por link nao funciona (#37)", "description": "Link de pagamento manual nao processa. Status nao atualiza automaticamente.", "prompt": "1) create-stripe-manual-checkout. 2) webhook processa manual booking. 3) metadata booking_id.", "priority": "high", "status": "todo"},
    {"title": "Bug: colaborador sem acesso a embarcacao/reserva (#33)", "description": "Colaborador nao ve embarcacao compartilhada nem botao de reserva manual.", "prompt": "1) Dashboard query incluir collaborator vessels. 2) Botao reserva verifica is_host, incluir collaborators. 3) RLS.", "priority": "high", "status": "todo"},
    {"title": "Bug: chat erro em reservas concluidas (#25)", "description": "Erro ao abrir chat de reservas concluidas. Modo read-only deve funcionar.", "prompt": "1) ChatWindow closed_at. 2) RLS SELECT conversas fechadas. 3) Tratamento erro frontend.", "priority": "high", "status": "todo"},
    {"title": "Politicas legais no checkout (#27)", "description": "Adicionar politicas de pagamento, cancelamento e reembolso no checkout. Respaldo juridico pro operador e Canoe.", "prompt": "1) Componente CheckoutPolicies acordeao. 2) Politica cancelamento do operador. 3) Termos de uso. 4) Direito do consumidor. 5) Visual profissional.", "priority": "high", "status": "todo"},
    {"title": "Direito de arrependimento: reembolso total 7 dias (#31)", "description": "CDC: compras online tem direito de arrependimento 7 dias com reembolso total, independente da politica do operador.", "prompt": "1) Verificar created_at < 7 dias no cancelamento. 2) Reembolso 100% obrigatorio. 3) Atualizar process-stripe-refund. 4) Informar usuario no frontend. 5) Documentar BUSINESS_RULES.md.", "priority": "high", "status": "todo"},
    {"title": "Bug: pagamento parcial nao mostra saldo devedor (#35)", "description": "Reserva manual parcial nao mostra que falta pagar. Deve exibir Falta Pagar R$ X claramente.", "prompt": "1) Detalhes da reserva manual. 2) Calcular remaining = total - paid. 3) Badge vermelho Falta Pagar. 4) Barra de progresso visual.", "priority": "medium", "status": "todo"},
    {"title": "Fluxo confirmar/iniciar passeio (#35)", "description": "Ao confirmar passeio, voltar para tela do dia com passageiros e botoes Iniciar Passeio / Cancelar Passeio.", "prompt": "1) Pos-confirmacao redirecionar para DayView. 2) Botoes Iniciar Passeio e Cancelar. 3) Status: confirmed > in_progress > completed. 4) Lista passageiros com check-in.", "priority": "medium", "status": "todo"},
    {"title": "Telefone obrigatorio para passageiros (#31)", "description": "Login Google nao tem telefone. Tornar obrigatorio antes de reservar. Exibir no detalhamento da reserva pro operador.", "prompt": "1) Verificar phone no profile apos login. 2) Modal completar perfil. 3) Exibir no BookingDetail pro operador. 4) Validar formato brasileiro.", "priority": "medium", "status": "todo"},
    {"title": "Header web: avatar iniciais, remover botoes (#22)", "description": "Navbar web: remover Navegar/Operador, Ajuda, Sair. Deixar avatar com iniciais (CS). Dropdown: Perfil, Ajuda, Sair.", "prompt": "1) Header/Navbar component. 2) Avatar com iniciais. 3) Dropdown menu. 4) Simetria com mobile.", "priority": "medium", "status": "todo"},
    {"title": "Explorar: layout consistente com home (#23)", "description": "Pagina Explorar muda tamanho e layout. Deve ficar identica a home.", "prompt": "1) Comparar Home vs Explore. 2) Unificar container/max-width/padding. 3) Sem reflow visual na transicao.", "priority": "medium", "status": "todo"},
    {"title": "Operador abaixo dos campos de reserva (#24/#29)", "description": "Perfil operador por ultimo, depois dos campos de reserva. Botao Ver Perfil. Corrigir botao cortado na web.", "prompt": "1) VesselDetail mover operador abaixo. 2) Secao separada com Ver Perfil. 3) Fix CSS overflow botao cortado.", "priority": "medium", "status": "todo"},
    {"title": "Preco integral + detalhamento expansivel (#26)", "description": "Checkout: preco total unico. Botao Detalhamento do preco expande breakdown. Taxa visivel vs embutida.", "prompt": "1) Exibir TOTAL grande. 2) Acordeao Detalhamento. 3) visible: base+taxa. 4) included: total com nota.", "priority": "medium", "status": "todo"},
    {"title": "QR Code: melhorar exibicao reservas (#31)", "description": "Local simplificado, QR visivel, chat ao lado do operador, Alterar Data | Cancelar lado a lado, QR no detalhe.", "prompt": "1) Endereco curto. 2) QR visivel por padrao. 3) Chat ao lado operador. 4) Botoes lado a lado. 5) QR no detalhe.", "priority": "medium", "status": "todo"},
    {"title": "Reserva manual: vagas disponiveis e bloquear privativo (#32)", "description": "Mostrar vagas por dia no calendario manual. Dia com compartilhado desabilita privativo e vice-versa.", "prompt": "1) Vagas restantes por dia. 2) Query bookings confirmadas. 3) Desabilitar privativo se tem compartilhado. 4) Vice-versa.", "priority": "medium", "status": "todo"},
    {"title": "Editar permissoes de colaboradores (#33)", "description": "Adicionar botao Editar permissoes ao lado de Excluir na lista de colaboradores.", "prompt": "1) VesselCollaborators botao Editar. 2) Modal com checkboxes. 3) vessel_collaborators.permissions.", "priority": "medium", "status": "todo"},
    {"title": "Reservas web em grade compacta (#25)", "description": "Reservas concluidas em grade na web ao inves de lista.", "prompt": "1) CSS grid responsive. 2) Cards compactos. 3) Lista no mobile.", "priority": "low", "status": "todo"},
    {"title": "Botao Ver Todas Notificacoes (#36)", "description": "Botao para acessar historico completo de notificacoes.", "prompt": "1) Botao Ver Todas. 2) Pagina /notifications paginada. 3) Lida/nao-lida.", "priority": "low", "status": "todo"},
    {"title": "Gerar PIX no check-in manual (#37)", "description": "QR Code PIX na tela do vendedor para cobranca presencial.", "prompt": "1) PIX via Stripe ou API banco. 2) Componente PixQRCode. 3) Webhook conciliacao.", "priority": "low", "status": "todo"},
]

for i, t in enumerate(new_tasks):
    t["id"] = f"v4_{i+1:02d}"
    t["number"] = max_number + 1 + i
    t["projectId"] = "canoe-claudio"
    t["createdAt"] = now
    t["updatedAt"] = now
    t["order"] = max_order + 1 + i
    t["inboxAt"] = now

tasks.extend(new_tasks)
data["tasks"] = tasks

with open(filepath, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"Added {len(new_tasks)} tasks. Total: {len(tasks)}. Todo: {sum(1 for t in tasks if t.get('status') == 'todo')}")

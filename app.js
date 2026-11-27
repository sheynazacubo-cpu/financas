(function () {
  "use strict";

  const CFG = window.FINANCAS_CONFIG || {};
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const CATS = {
    entrada: ["Salário", "Negócio", "Vendas", "Presente", "Outros"],
    saida: ["Alimentação", "Casa", "Transporte", "Saúde", "Educação", "Contas (luz, água, net)", "Crédito / Recargas", "Família", "Lazer", "Outros"],
  };
  const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const $ = (id) => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  let txs = [];
  let editing = null;
  let formType = "saida";
  let relPeriod = "semana";
  let relAnchor = new Date();
  let calMonth = startOfMonth(new Date());
  let calSel = isoDate(new Date());
  let channel = null;

  // ---------- helpers ----------
  function isoDate(d) {
    const z = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }
  function money(n) {
    const v = Math.round(Number(n) * 100) / 100;
    const s = Math.abs(v).toLocaleString("pt-PT", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2, useGrouping: "always" });
    return (v < 0 ? "−" : "") + s + " MT";
  }
  function niceDate(s) { const d = parseISO(s); return d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("on"), 2200); }
  function sum(list, type) { return list.filter((t) => t.type === type).reduce((a, t) => a + Number(t.amount), 0); }
  function inRange(t, from, to) { return t.occurred_at >= from && t.occurred_at <= to; }

  // ---------- auth ----------
  async function boot() {
    if (!CFG.supabaseUrl || CFG.supabaseUrl.startsWith("COLE")) {
      document.body.innerHTML = '<div class="login"><h1>Quase pronto</h1><p class="muted">Falta configurar a ligação à base de dados (config.js).</p></div>';
      return;
    }
    const { data } = await sb.auth.getSession();
    if (data.session) startApp(); else showLogin();
    sb.auth.onAuthStateChange((ev, session) => {
      if (ev === "SIGNED_OUT" || !session) showLogin();
    });
  }

  function showLogin() {
    $("app").hidden = true;
    $("loginScreen").hidden = false;
    if (channel) { sb.removeChannel(channel); channel = null; }
  }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("loginErr").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
    if (error) { $("loginErr").textContent = "Email ou palavra-passe errados."; return; }
    $("lPass").value = "";
    startApp();
  });

  async function startApp() {
    $("loginScreen").hidden = true;
    $("app").hidden = false;
    updateWho();
    await load();
    subscribe();
  }

  // ---------- data ----------
  async function load() {
    const { data, error } = await sb.from("transactions")
      .select("id, type, amount, category, description, occurred_at, created_by, created_at")
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) { toast("Sem ligação. A tentar de novo…"); return; }
    txs = data || [];
    render();
  }

  function subscribe() {
    if (channel) return;
    channel = sb.channel("tx-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => load())
      .subscribe();
  }
  // Ao voltar à app (ex.: telemóvel desbloqueado), buscar os dados mais recentes.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("app").hidden) load(); });
  window.addEventListener("online", () => { if (!$("app").hidden) load(); });

  // ---------- render ----------
  function render() { renderHome(); renderRel(); renderCal(); renderAll(); }

  function rowHTML(t) {
    const sign = t.type === "entrada" ? "+" : "−";
    const who = t.created_by ? " · " + esc(t.created_by) : "";
    return '<li data-id="' + t.id + '" style="cursor:pointer"><div class="meta"><div class="t">' + esc(t.description || t.category) +
      '</div><div class="muted small">' + esc(t.category) + " · " + niceDate(t.occurred_at) + who + '</div></div><div class="amt ' +
      (t.type === "entrada" ? "in" : "out") + '">' + sign + " " + money(t.amount) + "</div></li>";
  }
  function fillList(el, list, empty) { el.innerHTML = list.length ? list.map(rowHTML).join("") : '<li class="muted">' + empty + "</li>"; }

  function renderHome() {
    const tin = sum(txs, "entrada"), tout = sum(txs, "saida");
    $("bal").textContent = money(tin - tout);
    $("totIn").textContent = money(tin);
    $("totOut").textContent = money(tout);
    const now = new Date();
    const from = isoDate(startOfMonth(now)), to = isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const outs = txs.filter((t) => t.type === "saida" && inRange(t, from, to));
    const byCat = {};
    outs.forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
    const total = outs.reduce((a, t) => a + Number(t.amount), 0);
    const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    $("cats").innerHTML = rows.length ? rows.map(([c, v]) =>
      '<div class="catbar"><div class="top"><span>' + esc(c) + "</span><b>" + money(v) + '</b></div><div class="bar"><span style="width:' +
      Math.max(2, (v / total) * 100).toFixed(1) + '%"></span></div></div>').join("") : '<p class="muted">Sem saídas registadas este mês.</p>';
    fillList($("recent"), txs.slice(0, 8), "Ainda sem registos. Toque em + Entrada ou − Saída.");
  }

  function relRange() {
    if (relPeriod === "semana") {
      const s = startOfWeek(relAnchor);
      return { from: s, to: addDays(s, 6), title: s.getDate() + " " + MONTHS[s.getMonth()].slice(0, 3) + " – " + addDays(s, 6).getDate() + " " + MONTHS[addDays(s, 6).getMonth()].slice(0, 3) };
    }
    const s = startOfMonth(relAnchor);
    const e = new Date(s.getFullYear(), s.getMonth() + 1, 0);
    return { from: s, to: e, title: MONTHS[s.getMonth()] + " " + s.getFullYear() };
  }

  function renderRel() {
    const r = relRange();
    const from = isoDate(r.from), to = isoDate(r.to);
    const list = txs.filter((t) => inRange(t, from, to));
    const tin = sum(list, "entrada"), tout = sum(list, "saida");
    $("relTitle").textContent = r.title;
    $("rIn").textContent = money(tin);
    $("rOut").textContent = money(tout);
    $("rBal").textContent = money(tin - tout);

    const days = [];
    for (let d = new Date(r.from); d <= r.to; d = addDays(d, 1)) days.push(isoDate(d));
    const per = days.map((day) => { const l = list.filter((t) => t.occurred_at === day); return [sum(l, "entrada"), sum(l, "saida")]; });
    const max = Math.max(1, ...per.flat());
    $("rChart").innerHTML = per.map(([i, o], k) =>
      '<div class="c" title="' + niceDate(days[k]) + ": +" + money(i) + " / −" + money(o) + '"><span class="i" style="height:' + (i / max * 100) + '%"></span><span class="o" style="height:' + (o / max * 100) + '%"></span></div>').join("");
    $("rChartLbl").textContent = relPeriod === "semana" ? "Seg → Dom · verde = entradas, vermelho = saídas" : "Dia 1 → " + days.length + " · verde = entradas, vermelho = saídas";

    let txt;
    if (!list.length) txt = "Sem registos neste período.";
    else {
      const byCat = {};
      list.filter((t) => t.type === "saida").forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount); });
      const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
      const p = relPeriod === "semana" ? "Nesta semana" : "Neste mês";
      txt = p + " entraram " + money(tin) + " e saíram " + money(tout) + ". ";
      txt += tin - tout >= 0 ? "Sobraram " + money(tin - tout) + "." : "Gastou-se " + money(tout - tin) + " a mais do que entrou.";
      if (top) txt += " O maior gasto foi em " + top[0] + " (" + money(top[1]) + ").";
    }
    $("rSummary").textContent = txt;
    fillList($("rList"), list, "Sem registos neste período.");
  }

  function renderCal() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    $("calTitle").textContent = MONTHS[m] + " " + y;
    const first = new Date(y, m, 1);
    const start = addDays(first, -first.getDay());
    const today = isoDate(new Date());
    let html = WD.map((w) => '<div class="h">' + w + "</div>").join("");
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), iso = isoDate(d);
      const l = txs.filter((t) => t.occurred_at === iso);
      const hasIn = l.some((t) => t.type === "entrada"), hasOut = l.some((t) => t.type === "saida");
      html += '<button data-day="' + iso + '" class="' + (d.getMonth() !== m ? "other " : "") + (iso === calSel ? "sel " : "") + (iso === today ? "today" : "") + '">' +
        d.getDate() + '<div class="dots">' + (hasIn ? '<i class="i"></i>' : "") + (hasOut ? '<i class="o"></i>' : "") + "</div></button>";
    }
    $("cal").innerHTML = html;
    const sd = parseISO(calSel);
    $("dayTitle").textContent = WD[sd.getDay()] + ", " + sd.getDate() + " de " + MONTHS[sd.getMonth()];
    fillList($("dayList"), txs.filter((t) => t.occurred_at === calSel), "Sem registos neste dia.");
  }

  function renderAll() {
    const q = $("search").value.trim().toLowerCase();
    const list = q ? txs.filter((t) => (t.description || "").toLowerCase().includes(q) || t.category.toLowerCase().includes(q)) : txs;
    $("allCount").textContent = list.length + (list.length === 1 ? " registo" : " registos");
    fillList($("allList"), list, "Nada encontrado.");
  }

  // ---------- form ----------
  function setType(t) {
    formType = t;
    document.querySelectorAll("#typeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    const cur = $("fCat").value;
    $("fCat").innerHTML = CATS[t].map((c) => "<option>" + esc(c) + "</option>").join("");
    if (CATS[t].includes(cur)) $("fCat").value = cur;
    $("txTitle").textContent = (editing ? "Editar " : "Nova ") + (t === "entrada" ? "entrada" : "saída");
  }

  function openForm(type, tx) {
    editing = tx || null;
    $("txErr").textContent = "";
    setType(tx ? tx.type : type);
    if (tx && !CATS[tx.type].includes(tx.category)) $("fCat").insertAdjacentHTML("beforeend", "<option>" + esc(tx.category) + "</option>");
    $("fCat").value = tx ? tx.category : CATS[formType][0];
    $("fAmount").value = tx ? String(tx.amount).replace(".", ",") : "";
    $("fDesc").value = tx ? tx.description || "" : "";
    $("fDate").value = tx ? tx.occurred_at : (document.querySelector(".view.on").id === "v-cal" ? calSel : isoDate(new Date()));
    $("txDelete").hidden = !tx;
    $("txDialog").showModal();
    if (!tx) setTimeout(() => $("fAmount").focus(), 50);
  }

  function parseAmount(s) {
    let v = s.replace(/\s|MT/gi, "");
    if (v.includes(",")) v = v.replace(/\./g, "").replace(",", ".");
    const n = Number(v);
    return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }

  $("txForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseAmount($("fAmount").value);
    if (!amount) { $("txErr").textContent = "Escreva um valor válido (ex.: 1500 ou 250,50)."; return; }
    const row = { type: formType, amount, category: $("fCat").value, description: $("fDesc").value.trim() || null, occurred_at: $("fDate").value };
    $("txSave").disabled = true;
    let res;
    if (editing) res = await sb.from("transactions").update(row).eq("id", editing.id);
    else res = await sb.from("transactions").insert(Object.assign({ created_by: store.get("financas_who") || null }, row));
    $("txSave").disabled = false;
    if (res.error) { $("txErr").textContent = "Não foi possível guardar. Verifique a internet e tente de novo."; return; }
    $("txDialog").close();
    toast(editing ? "Registo atualizado" : "Registo guardado");
    await load();
  });

  $("txDelete").addEventListener("click", async () => {
    if (!editing) return;
    if (!confirm("Apagar este registo?")) return;
    const { error } = await sb.from("transactions").delete().eq("id", editing.id);
    if (error) { $("txErr").textContent = "Não foi possível apagar."; return; }
    $("txDialog").close();
    toast("Registo apagado");
    await load();
  });

  $("txCancel").addEventListener("click", () => $("txDialog").close());
  document.querySelectorAll("#typeSeg button").forEach((b) => b.addEventListener("click", () => setType(b.dataset.t)));
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => openForm(b.dataset.add)));

  // Tocar num registo abre para editar
  document.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li) return;
    const tx = txs.find((t) => t.id === li.dataset.id);
    if (tx) openForm(tx.type, tx);
  });

  // ---------- navigation ----------
  document.querySelectorAll(".nav button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".nav button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + b.dataset.v));
    window.scrollTo(0, 0);
  }));
  document.querySelectorAll("#relSeg button").forEach((b) => b.addEventListener("click", () => {
    relPeriod = b.dataset.p; relAnchor = new Date();
    document.querySelectorAll("#relSeg button").forEach((x) => x.classList.toggle("on", x === b));
    renderRel();
  }));
  $("relPrev").addEventListener("click", () => { relAnchor = relPeriod === "semana" ? addDays(relAnchor, -7) : new Date(relAnchor.getFullYear(), relAnchor.getMonth() - 1, 1); renderRel(); });
  $("relNext").addEventListener("click", () => { relAnchor = relPeriod === "semana" ? addDays(relAnchor, 7) : new Date(relAnchor.getFullYear(), relAnchor.getMonth() + 1, 1); renderRel(); });
  $("calPrev").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1); renderCal(); });
  $("calNext").addEventListener("click", () => { calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1); renderCal(); });
  $("cal").addEventListener("click", (e) => { const b = e.target.closest("button[data-day]"); if (!b) return; calSel = b.dataset.day; const d = parseISO(calSel); if (d.getMonth() !== calMonth.getMonth()) calMonth = startOfMonth(d); renderCal(); });
  $("search").addEventListener("input", renderAll);

  // ---------- settings ----------
  function updateWho() { const w = store.get("financas_who"); $("whoLine").textContent = w ? "Telemóvel: " + w : ""; }
  $("settingsBtn").addEventListener("click", () => { $("whoSel").value = store.get("financas_who") || ""; $("setDialog").showModal(); });
  $("whoSel").addEventListener("change", () => { store.set("financas_who", $("whoSel").value); updateWho(); });
  $("logoutBtn").addEventListener("click", async () => { $("setDialog").close(); await sb.auth.signOut(); });

  boot();
})();

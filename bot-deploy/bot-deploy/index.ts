import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Message,
  TextChannel,
  GuildMember,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ButtonInteraction,
  CategoryChannel,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Collection,
  Invite,
  Guild,
} from "discord.js";

const TOKEN = process.env["DISCORD_BOT_TOKEN"];
if (!TOKEN) throw new Error("Brak DISCORD_BOT_TOKEN w zmiennych środowiskowych");

// ─── Stałe ────────────────────────────────────────────────────────────────────

const VIOLATIONS_CHANNEL_NAME = "przekroczenia";
const EXEMPT_ROLE_NAME        = "🗿Mody&Pluginy🗿";
const VERIFIED_ROLE_NAME      = "🤡Zweryfikowany🤡";

const LINK_ATTEMPTS_LIMIT  = 3;
const MUTE_DURATION_MS     = 60 * 60 * 1000;
const INVITE_REWARD_NEEDED = 10;

const LINK_REGEX = /https?:\/\/\S+|www\.\S+|\S+\.\S{2,}\/\S*/gi;

const SWEAR_WORDS = [
  "kurwa","kurwy","kurwach","kurwą","chuj","chuja","chujowi",
  "pizda","pizdę","pizdą","pizdzie","pierdol","pierdolić",
  "pierdolony","pierdolona","pierdolone","jebać","jebany",
  "jebana","jebane","jeb","huj","huja","skurwiel","skurwysyn",
  "skurwysyna","kurwison","matkojebca","spierdolić","spierdalaj",
  "wypierdalaj","odpierdolić","zapierdolić","suka","sukinsyn",
  "cwel","cwela","cweli","pedał","pedała","debil","debila",
  "idiota","idioty","gówno","gówna","gównem",
  "shit","fuck","fucking","fucker","bitch","asshole","bastard","damn","cunt",
];

// Button IDs
const BTN_VERIFY         = "verify_user";
const BTN_OPEN_TICKET    = "ticket_open";
const BTN_BUY_MOD        = "ticket_buy_mod";
const BTN_BUY_PLUGIN     = "ticket_buy_plugin";
const BTN_BUG_MOD        = "ticket_bug_mod";
const BTN_BUG_PLUGIN     = "ticket_bug_plugin";
const BTN_CLOSE          = "ticket_close";
const BTN_REWARD_MOD     = "reward_free_mod";
const BTN_REWARD_PLUGIN  = "reward_free_plugin";

// ─── Stany ────────────────────────────────────────────────────────────────────

// Mapa: userId -> channelId aktywnego ticketu
const activeTickets = new Map<string, string>();

// Licznik prób wysyłania linków per użytkownik
const linkAttempts = new Map<string, number>();

// Cache zaproszeń: guildId -> (inviteCode -> liczba użyć)
const inviteCache = new Map<string, Map<string, number>>();

// Liczba zaproszonych osób per użytkownik: userId -> count
const inviteCount = new Map<string, number>();

// Kto już odebrał nagrodę (jeden raz): Set<userId>
const claimedRewards = new Set<string>();

// ─── Klient ───────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel],
});

// ─── Slash commands ────────────────────────────────────────────────────────────

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Wysyła panel do otwierania ticketów")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("weryfikacja")
    .setDescription("Wysyła panel weryfikacji")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("licznik-zaproszen")
    .setDescription("Sprawdza ile osób zaprosiłeś na serwer")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("nagrody-zapros")
    .setDescription("Odbierz nagrodę za zaproszenie 10 osób")
    .toJSON(),
];

async function registerCommands(clientId: string): Promise<void> {
  const rest = new REST().setToken(TOKEN!);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log("Slash commands zarejestrowane globalnie");
}

// ─── Invite tracking ──────────────────────────────────────────────────────────

async function cacheGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    const map = new Map<string, number>();
    invites.forEach((inv) => map.set(inv.code, inv.uses ?? 0));
    inviteCache.set(guild.id, map);
  } catch {
    console.warn(`Brak uprawnień do pobrania zaproszeń na ${guild.name}`);
  }
}

// ─── Panel weryfikacji ────────────────────────────────────────────────────────

function buildVerifyPanel() {
  const embed = new EmbedBuilder()
    .setTitle("✅ Weryfikacja")
    .setDescription(
      "Aby uzyskać dostęp do serwera, kliknij przycisk poniżej.\n\nPrzez weryfikację potwierdzasz, że zapoznałeś się z regulaminem.",
    )
    .setColor(0x57f287)
    .setFooter({ text: "Kliknij przycisk aby się zweryfikować" });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_VERIFY)
      .setLabel("✅ Zweryfikuj się")
      .setStyle(ButtonStyle.Success),
  );

  return { embeds: [embed], components: [row] };
}

async function handleVerify(interaction: ButtonInteraction): Promise<void> {
  const guild  = interaction.guild!;
  const member = interaction.member as GuildMember;
  const role   = guild.roles.cache.find((r) => r.name === VERIFIED_ROLE_NAME);

  if (!role) {
    await interaction.reply({
      content: `❌ Nie znaleziono roli **${VERIFIED_ROLE_NAME}**. Poproś admina żeby ją stworzył.`,
      ephemeral: true,
    });
    return;
  }

  if (member.roles.cache.has(role.id)) {
    await interaction.reply({ content: "✅ Jesteś już zweryfikowany!", ephemeral: true });
    return;
  }

  try {
    await member.roles.add(role, "Weryfikacja przez panel");
    await interaction.reply({
      content: `✅ Zostałeś zweryfikowany! Witaj na serwerze, <@${member.id}>! 🎉`,
      ephemeral: true,
    });
  } catch (err) {
    console.error("Błąd nadawania roli weryfikacji:", err);
    await interaction.reply({
      content: "❌ Wystąpił błąd podczas weryfikacji. Skontaktuj się z moderatorem.",
      ephemeral: true,
    });
  }
}

// ─── Panel ticketów ───────────────────────────────────────────────────────────

function buildMainPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 Wsparcie")
    .setDescription(
      "**Potrzebujesz pomocy?**\n\nKliknij przycisk poniżej, aby stworzyć ticket.\nMożesz mieć tylko **1 aktywny ticket** jednocześnie.\n\n📜",
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_OPEN_TICKET)
      .setLabel("📜 Stwórz Ticket")
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

function buildCategoryPanel(userId: string) {
  const embed = new EmbedBuilder()
    .setTitle("📜 Wybierz kategorię")
    .setDescription(
      `Witaj <@${userId}>! 👋\n\nWybierz odpowiednią kategorię, a moderator wkrótce się odezwie.`,
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN_BUY_MOD).setLabel("🛠️ Kupno Moda").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BTN_BUY_PLUGIN).setLabel("🔌 Kupno Pluginu").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BTN_BUG_MOD).setLabel("⚠️ Błąd Moda").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(BTN_BUG_PLUGIN).setLabel("📜 Błąd Pluginu").setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

// ─── Helpers: moderacja ───────────────────────────────────────────────────────

function hasExemptRole(member: GuildMember): boolean {
  return member.roles.cache.some((r) => r.name === EXEMPT_ROLE_NAME);
}

function containsLink(content: string): boolean {
  LINK_REGEX.lastIndex = 0;
  return LINK_REGEX.test(content);
}

function containsSwear(content: string): boolean {
  const lower = content.toLowerCase();
  return SWEAR_WORDS.some((word) => {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re  = new RegExp(
      `(?:^|\\s|[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ])${esc}(?:$|\\s|[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ])`,
      "i",
    );
    return re.test(lower) || lower.includes(word);
  });
}

function findChannelByName(guild: NonNullable<Message["guild"]>, name: string): TextChannel | null {
  const ch = guild.channels.cache.find(
    (c) => c.name.toLowerCase().includes(name.toLowerCase()) && c.isTextBased(),
  );
  return ch ? (ch as TextChannel) : null;
}

async function logViolation(message: Message, reason: string, extra?: string): Promise<void> {
  if (!message.guild) return;
  const channel = findChannelByName(message.guild, VIOLATIONS_CHANNEL_NAME);
  if (!channel) { console.warn("Brak kanału przekroczenia"); return; }
  const ts = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
  await channel.send(
    [
      `**🚨 Naruszenie zasad**`,
      `👤 Użytkownik: ${message.author.tag} (<@${message.author.id}>)`,
      `📍 Kanał: <#${message.channelId}>`,
      `📝 Powód: ${reason}`,
      extra ? `ℹ️ Szczegóły: ${extra}` : null,
      `💬 Treść: \`${message.content.slice(0, 200).replace(/`/g, "'")}\``,
      `🕐 Czas: ${ts}`,
    ].filter(Boolean).join("\n"),
  );
}

async function muteUser(message: Message): Promise<void> {
  if (!message.guild || !message.member) return;
  try {
    await message.member.timeout(MUTE_DURATION_MS, "Wysłanie linku 3 razy (automod)");
    const ch = findChannelByName(message.guild, VIOLATIONS_CHANNEL_NAME);
    if (ch) {
      const ts = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });
      await ch.send([
        `**🔇 Użytkownik wyciszony**`,
        `👤 Użytkownik: ${message.author.tag} (<@${message.author.id}>)`,
        `⏱️ Czas wyciszenia: 1 godzina`,
        `📝 Powód: Wysłanie linku 3 razy z rzędu`,
        `🕐 Czas: ${ts}`,
      ].join("\n"));
    }
    linkAttempts.delete(message.author.id);
  } catch (err) {
    console.error("Błąd podczas wyciszania:", err);
  }
}

// ─── Helpers: tickety ─────────────────────────────────────────────────────────

async function openTicketChannel(interaction: ButtonInteraction): Promise<void> {
  const guild  = interaction.guild!;
  const member = interaction.member as GuildMember;
  const userId = member.id;

  const existingId = activeTickets.get(userId);
  if (existingId) {
    const existing = guild.channels.cache.get(existingId);
    if (existing) {
      await interaction.reply({ content: `❌ Masz już otwarty ticket: <#${existingId}>.`, ephemeral: true });
      return;
    }
    activeTickets.delete(userId);
  }

  const modRole  = guild.roles.cache.find((r) => r.name === EXEMPT_ROLE_NAME);
  const category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes("ticket"),
  ) as CategoryChannel | undefined;

  const ticketChannel = await guild.channels.create({
    name: `ticket-${member.user.username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category ?? null,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...(modRole ? [{ id: modRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }] : []),
      { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ],
    topic: `Ticket | Użytkownik: ${member.user.tag} (${userId})`,
  });

  activeTickets.set(userId, ticketChannel.id);
  await ticketChannel.send(buildCategoryPanel(userId));
  await interaction.reply({ content: `✅ Twój ticket: <#${ticketChannel.id}>`, ephemeral: true });
}

async function handleCategorySelect(interaction: ButtonInteraction, label: string, color: number): Promise<void> {
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(label)
        .setDescription(`<@${interaction.user.id}> wybrał: **${label}**\n\nModerator wkrótce się odezwie. Opisz swój problem poniżej.`)
        .setColor(color)
        .setTimestamp(),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(BTN_CLOSE).setLabel("🔒 Zamknij ticket").setStyle(ButtonStyle.Danger),
      ),
    ],
  });
}

async function closeTicket(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member as GuildMember;
  if (!hasExemptRole(member)) {
    await interaction.reply({ content: `❌ Tylko **${EXEMPT_ROLE_NAME}** może zamykać tickety.`, ephemeral: true });
    return;
  }
  const channel = interaction.channel as TextChannel;
  for (const [uid, cid] of activeTickets.entries()) {
    if (cid === channel.id) { activeTickets.delete(uid); break; }
  }
  await interaction.reply({ content: "🔒 Zamykanie ticketu za 5 sekund..." });
  setTimeout(() => channel.delete("Ticket zamknięty").catch(console.error), 5000);
}

// ─── Helpers: nagrody za zaproszenia ─────────────────────────────────────────

async function handleRewardClaim(interaction: ButtonInteraction, type: "mod" | "plugin"): Promise<void> {
  const userId = interaction.user.id;
  const guild  = interaction.guild!;
  const label  = type === "mod" ? "🛠️ Darmowy Mod" : "🔌 Darmowy Plugin";

  // Otwórz ticket nagrodowy dla moderatora
  const modRole  = guild.roles.cache.find((r) => r.name === EXEMPT_ROLE_NAME);
  const category = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase().includes("ticket"),
  ) as CategoryChannel | undefined;

  const rewardChannel = await guild.channels.create({
    name: `nagroda-${interaction.user.username}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: category ?? null,
    permissionOverwrites: [
      { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
      { id: userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      ...(modRole ? [{ id: modRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }] : []),
      { id: client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
    ],
  });

  claimedRewards.add(userId);

  const embed = new EmbedBuilder()
    .setTitle(`🎁 Nagroda: ${label}`)
    .setDescription(
      `<@${userId}> odbiera nagrodę za zaproszenie **${INVITE_REWARD_NEEDED} osób**!\n\n**Typ nagrody:** ${label}\n\nModerator wkrótce się z Tobą skontaktuje.`,
    )
    .setColor(type === "mod" ? 0x5865f2 : 0x57f287)
    .setTimestamp();

  const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN_CLOSE).setLabel("🔒 Zamknij").setStyle(ButtonStyle.Danger),
  );

  await rewardChannel.send({ embeds: [embed], components: [closeRow] });

  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle("🎁 Nagroda odebrana!")
        .setDescription(`Wybrałeś: **${label}**\n\nKanał został otwarty: <#${rewardChannel.id}>.\nModerator wkrótce się odezwie!`)
        .setColor(0x57f287),
    ],
    components: [],
  });
}

// ─── Eventy ───────────────────────────────────────────────────────────────────

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Bot uruchomiony jako ${readyClient.user.tag}`);
  const inviteLink = `https://discord.com/oauth2/authorize?client_id=${readyClient.user.id}&permissions=1099511696423&scope=bot+applications.commands`;
  console.log(`\n🔗 LINK DO DODANIA BOTA:\n${inviteLink}\n`);

  await registerCommands(readyClient.user.id);

  // Załaduj cache zaproszeń dla wszystkich serwerów
  for (const guild of readyClient.guilds.cache.values()) {
    await guild.channels.fetch().catch(() => null);
    await guild.roles.fetch().catch(() => null);
    await cacheGuildInvites(guild);
  }
});

// Śledzenie nowych zaproszeń (tworzenie/usuwanie)
client.on(Events.InviteCreate, async (invite) => {
  if (!invite.guild) return;
  const map = inviteCache.get(invite.guild.id) ?? new Map<string, number>();
  map.set(invite.code, invite.uses ?? 0);
  inviteCache.set(invite.guild.id, map);
});

client.on(Events.InviteDelete, async (invite) => {
  if (!invite.guild) return;
  const map = inviteCache.get(invite.guild.id);
  if (map) map.delete(invite.code);
});

// Dołączenie nowego członka — sprawdź które zaproszenie zostało użyte
client.on(Events.GuildMemberAdd, async (member) => {
  const guild   = member.guild;
  const cached  = inviteCache.get(guild.id) ?? new Map<string, number>();

  let newInvites: Collection<string, Invite>;
  try {
    newInvites = await guild.invites.fetch();
  } catch {
    return;
  }

  // Znajdź zaproszenie, którego liczba użyć wzrosła
  let inviterId: string | null = null;
  for (const [code, uses] of cached.entries()) {
    const current = newInvites.get(code);
    if (current && (current.uses ?? 0) > uses) {
      inviterId = current.inviterId ?? null;
      break;
    }
  }

  // Zaktualizuj cache
  const updatedMap = new Map<string, number>();
  newInvites.forEach((inv) => updatedMap.set(inv.code, inv.uses ?? 0));
  inviteCache.set(guild.id, updatedMap);

  // Zwiększ licznik dla zapraszającego
  if (inviterId) {
    const prev = inviteCount.get(inviterId) ?? 0;
    inviteCount.set(inviterId, prev + 1);
    console.log(`${member.user.tag} dołączył przez zaproszenie od ${inviterId} (łącznie: ${prev + 1})`);
  }
});

// Slash commands + przyciski
client.on(Events.InteractionCreate, async (interaction) => {
  // ── Slash commands ──
  if (interaction.isChatInputCommand()) {
    const cmd = interaction as ChatInputCommandInteraction;

    if (cmd.commandName === "ticket") {
      await cmd.reply({ ...buildMainPanel() });
      return;
    }

    if (cmd.commandName === "weryfikacja") {
      await cmd.reply({ ...buildVerifyPanel() });
      return;
    }

    if (cmd.commandName === "licznik-zaproszen") {
      const userId = cmd.user.id;
      const count  = inviteCount.get(userId) ?? 0;
      const needed = Math.max(0, INVITE_REWARD_NEEDED - count);

      const embed = new EmbedBuilder()
        .setTitle("📨 Twoje zaproszenia")
        .setDescription(
          [
            `👤 Użytkownik: <@${userId}>`,
            `📨 Zaprosiłeś: **${count}** ${count === 1 ? "osobę" : "osób"}`,
            `🎁 Do nagrody brakuje: **${needed}** ${needed === 1 ? "osoby" : "osób"}`,
            needed === 0 ? `\n✅ Możesz odebrać nagrodę przez **/nagrody-zapros**!` : "",
          ].join("\n"),
        )
        .setColor(count >= INVITE_REWARD_NEEDED ? 0x57f287 : 0x5865f2)
        .setTimestamp();

      await cmd.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (cmd.commandName === "nagrody-zapros") {
      const userId = cmd.user.id;
      const count  = inviteCount.get(userId) ?? 0;

      if (count < INVITE_REWARD_NEEDED) {
        await cmd.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("❌ Za mało zaproszeń")
              .setDescription(
                `Potrzebujesz **${INVITE_REWARD_NEEDED} zaproszeń**, aby odebrać nagrodę.\nMasz obecnie: **${count}/${INVITE_REWARD_NEEDED}**`,
              )
              .setColor(0xed4245),
          ],
          ephemeral: true,
        });
        return;
      }

      if (claimedRewards.has(userId)) {
        await cmd.reply({
          content: "❌ Już odebrałeś swoją nagrodę!",
          ephemeral: true,
        });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("🎁 Odbierz nagrodę!")
        .setDescription(
          `Gratulacje! Zaprosiłeś **${count} osób** na serwer! 🎉\n\nWybierz swoją nagrodę:`,
        )
        .setColor(0xfee75c);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(BTN_REWARD_MOD).setLabel("🛠️ Darmowy Mod").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(BTN_REWARD_PLUGIN).setLabel("🔌 Darmowy Plugin").setStyle(ButtonStyle.Success),
      );

      await cmd.reply({ embeds: [embed], components: [row], ephemeral: true });
      return;
    }
  }

  // ── Przyciski ──
  if (!interaction.isButton()) return;
  if (!interaction.guild)      return;

  const btn = interaction as ButtonInteraction;

  try {
    switch (btn.customId) {
      case BTN_VERIFY:        await handleVerify(btn); break;
      case BTN_OPEN_TICKET:   await openTicketChannel(btn); break;
      case BTN_BUY_MOD:       await handleCategorySelect(btn, "🛠️ Kupno Moda",    0x5865f2); break;
      case BTN_BUY_PLUGIN:    await handleCategorySelect(btn, "🔌 Kupno Pluginu", 0x57f287); break;
      case BTN_BUG_MOD:       await handleCategorySelect(btn, "⚠️ Błąd Moda",    0xed4245); break;
      case BTN_BUG_PLUGIN:    await handleCategorySelect(btn, "📜 Błąd Pluginu",  0x99aab5); break;
      case BTN_CLOSE:         await closeTicket(btn); break;
      case BTN_REWARD_MOD:    await handleRewardClaim(btn, "mod"); break;
      case BTN_REWARD_PLUGIN: await handleRewardClaim(btn, "plugin"); break;
    }
  } catch (err) {
    console.error("Błąd interakcji:", err);
    if (!btn.replied && !btn.deferred) {
      await btn.reply({ content: "❌ Wystąpił błąd.", ephemeral: true }).catch(() => null);
    }
  }
});

// Moderacja wiadomości
client.on(Events.MessageCreate, async (message: Message) => {
  if (message.author.bot) return;
  if (!message.guild)      return;
  const member = message.member;
  if (!member) return;

  const isExempt = hasExemptRole(member);
  const content  = message.content;
  let deleted    = false;

  if (!isExempt && containsLink(content)) {
    try { await message.delete(); deleted = true; } catch { /* już usunięta */ }
    const attempts = (linkAttempts.get(message.author.id) ?? 0) + 1;
    linkAttempts.set(message.author.id, attempts);
    await logViolation(message, "Wysłanie linku", `Próba ${attempts}/${LINK_ATTEMPTS_LIMIT}`);
    if (attempts >= LINK_ATTEMPTS_LIMIT) {
      await muteUser(message);
    } else {
      try {
        const dm = await message.author.createDM();
        await dm.send(`⚠️ Nie możesz wysyłać linków! (Próba ${attempts}/${LINK_ATTEMPTS_LIMIT}). Przy ${LINK_ATTEMPTS_LIMIT} próbach dostaniesz mute na 1h.`);
      } catch { /* DM zablokowane */ }
    }
  }

  if (!deleted && containsSwear(content)) {
    try { await message.delete(); } catch { /* już usunięta */ }
    await logViolation(message, "Użycie przekleństwa");
    try {
      const dm = await message.author.createDM();
      await dm.send(`⚠️ Twoja wiadomość została usunięta za użycie wulgaryzmów.`);
    } catch { /* DM zablokowane */ }
  }
});

client.login(TOKEN);

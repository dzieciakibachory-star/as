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
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
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

const REKRU_CHANNEL_NAME       = "rekrutacja";
const ADMIN_REKRU_CHANNEL_NAME = "adminrekru";
const WYNIKI_CHANNEL_NAME      = "wyniki-rekru";
const BTN_APLIKUJ              = "btn_aplikuj";
const MODAL_APLIKACJA          = "modal_aplikacja";

let rekrutacjaActive = false;

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
  new SlashCommandBuilder()
    .setName("rekrutacja_on")
    .setDescription("Włącza rekrutację — ogłoszenie z przyciskiem Aplikuj trafia na 💬rekrutacja💬")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("rekrutacja_off")
    .setDescription("Wyłącza rekrutację — ogłoszenie trafia na 💬rekrutacja💬")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("wyniki")
    .setDescription("Wysyła wynik rekrutacji dla kandydata na kanał adminrekru")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption((opt) =>
      opt.setName("nazwa").setDescription("Nazwa kandydata").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("wynik")
        .setDescription("Czy osoba przeszła rekrutację?")
        .setRequired(true)
        .addChoices(
          { name: "✅ Tak — przyjęty/a", value: "tak" },
          { name: "❌ Nie — odrzucony/a", value: "nie" }
        )
    )
    .toJSON(),
];

async function registerCommands(clientId: string): Promise<void> {
  const rest = new REST().setToken(TOKEN!);

  console.log("Czyszczenie starych slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: [] });
  console.log("Stare slash commands wyczyszczone.");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log("Rejestrowanie nowych slash commands...");
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log(`Slash commands zarejestrowane globalnie (${commands.length} komend).`);
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

function hasModyRole(member: GuildMember): boolean {
  return member.roles.cache.some((r) => r.name === EXEMPT_ROLE_NAME);
}

async function denyNoRole(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const member = interaction.member as GuildMember;
  if (!hasModyRole(member)) {
    await interaction.reply({
      content: `❌ Tylko rola **${EXEMPT_ROLE_NAME}** może używać tej komendy.`,
      ephemeral: true,
    });
    return true;
  }
  return false;
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

    if (cmd.commandName === "rekrutacja_on") {
      if (await denyNoRole(cmd)) return;
      if (rekrutacjaActive) {
        await cmd.reply({ content: "⚠️ Rekrutacja jest już włączona!", ephemeral: true });
        return;
      }
      rekrutacjaActive = true;
      const ch = findChannelByName(cmd.guild!, REKRU_CHANNEL_NAME);
      if (!ch) {
        await cmd.reply({ content: `❌ Nie znaleziono kanału zawierającego "rekrutacja"!`, ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle("📢 REKRUTACJA OTWARTA!")
        .setDescription(
          "🟢 **Rekrutacja do naszego zespołu została otwarta!**\n\n" +
          "Chcesz do nas dołączyć? Kliknij przycisk **📝 Aplikuj** poniżej i wypełnij krótki formularz.\n\n" +
          "Powodzenia wszystkim kandydatom! 🍀"
        )
        .setColor(0x57f287)
        .setTimestamp()
        .setFooter({ text: `Rekrutację otworzył: ${cmd.user.tag}` });
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(BTN_APLIKUJ)
          .setLabel("📝 Aplikuj")
          .setStyle(ButtonStyle.Success),
      );
      await ch.send({ embeds: [embed], components: [row] });
      await cmd.reply({ content: `✅ Rekrutacja włączona! Ogłoszenie z przyciskiem wysłane na <#${ch.id}>.`, ephemeral: true });
      return;
    }

    if (cmd.commandName === "rekrutacja_off") {
      if (await denyNoRole(cmd)) return;
      if (!rekrutacjaActive) {
        await cmd.reply({ content: "⚠️ Rekrutacja jest już wyłączona!", ephemeral: true });
        return;
      }
      rekrutacjaActive = false;
      const ch = findChannelByName(cmd.guild!, REKRU_CHANNEL_NAME);
      if (!ch) {
        await cmd.reply({ content: `❌ Nie znaleziono kanału zawierającego "rekrutacja"!`, ephemeral: true });
        return;
      }
      const embed = new EmbedBuilder()
        .setTitle("🔒 REKRUTACJA ZAMKNIĘTA")
        .setDescription(
          "🔴 **Rekrutacja została zakończona.**\n\n" +
          "Dziękujemy wszystkim za udział! Wyniki zostaną ogłoszone wkrótce."
        )
        .setColor(0xed4245)
        .setTimestamp()
        .setFooter({ text: `Rekrutację zamknął: ${cmd.user.tag}` });
      await ch.send({ embeds: [embed] });
      await cmd.reply({ content: `✅ Rekrutacja wyłączona! Ogłoszenie wysłane na <#${ch.id}>.`, ephemeral: true });
      return;
    }

    if (cmd.commandName === "wyniki") {
      if (await denyNoRole(cmd)) return;
      const nazwa = cmd.options.getString("nazwa", true);
      const wynik = cmd.options.getString("wynik", true);
      const wynikCh = findChannelByName(cmd.guild!, WYNIKI_CHANNEL_NAME);
      if (!wynikCh) {
        await cmd.reply({ content: `❌ Nie znaleziono kanału zawierającego "wyniki-rekru"!`, ephemeral: true });
        return;
      }
      const accepted = wynik === "tak";
      const embed = new EmbedBuilder()
        .setTitle(accepted ? "✅ WYNIK REKRUTACJI — PRZYJĘTY/A" : "❌ WYNIK REKRUTACJI — ODRZUCONY/A")
        .setDescription(
          `**Kandydat/ka:** ${nazwa}\n\n` +
          (accepted
            ? "🎉 Gratulacje! Osoba **przeszła** rekrutację i dołącza do zespołu!\nModerator skontaktuje się wkrótce w sprawie dalszych kroków."
            : "Niestety osoba **nie przeszła** rekrutacji.\nDziękujemy za udział i zapraszamy ponownie w przyszłości.")
        )
        .setColor(accepted ? 0x57f287 : 0xed4245)
        .setTimestamp()
        .setFooter({ text: `Ogłosił: ${cmd.user.tag}` });
      await wynikCh.send({ embeds: [embed] });
      await cmd.reply({ content: `✅ Wynik dla **${nazwa}** wysłany na <#${wynikCh.id}>.`, ephemeral: true });
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

  // ── Modal submit — formularz aplikacyjny ──
  if (interaction.isModalSubmit() && interaction.guild) {
    const modal = interaction as ModalSubmitInteraction;
    if (modal.customId === MODAL_APLIKACJA) {
      const wiek        = modal.fields.getTextInputValue("field_wiek");
      const dlaczego    = modal.fields.getTextInputValue("field_dlaczego");
      const doswiadcz   = modal.fields.getTextInputValue("field_doswiadczenie");
      const ts          = new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" });

      const embed = new EmbedBuilder()
        .setTitle("📋 Nowa Aplikacja Rekrutacyjna")
        .setColor(0x5865f2)
        .setThumbnail(modal.user.displayAvatarURL())
        .addFields(
          { name: "👤 Kandydat", value: `${modal.user.tag} (<@${modal.user.id}>)` },
          { name: "🎂 Ile masz lat?", value: wiek },
          { name: "❓ Dlaczego chcesz dołączyć?", value: dlaczego },
          { name: "🏆 Czy masz doświadczenie?", value: doswiadcz },
        )
        .setFooter({ text: `Wysłano: ${ts}` })
        .setTimestamp();

      // Wyślij tylko na kanał adminów 🫆adminrekru🫆 (gracze nie widzą aplikacji innych)
      const adminCh = findChannelByName(modal.guild!, ADMIN_REKRU_CHANNEL_NAME);
      if (adminCh) await adminCh.send({ embeds: [embed] });

      await modal.reply({
        content: "✅ Twoja aplikacja została wysłana! Poczekaj na odpowiedź od administracji. 🍀",
        ephemeral: true,
      });
      return;
    }
  }

  // ── Przyciski ──
  if (!interaction.isButton()) return;
  if (!interaction.guild)      return;

  const btn = interaction as ButtonInteraction;

  try {
    if (btn.customId === BTN_APLIKUJ) {
      if (!rekrutacjaActive) {
        await btn.reply({ content: "❌ Rekrutacja jest aktualnie zamknięta.", ephemeral: true });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId(MODAL_APLIKACJA)
        .setTitle("📋 Formularz Aplikacyjny");

      const wiekInput = new TextInputBuilder()
        .setCustomId("field_wiek")
        .setLabel("Ile masz lat?")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3)
        .setPlaceholder("np. 17");

      const dlaczegoInput = new TextInputBuilder()
        .setCustomId("field_dlaczego")
        .setLabel("Dlaczego chcesz dołączyć?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
        .setPlaceholder("Opisz dlaczego chcesz być częścią naszego zespołu...");

      const doswiadczenieInput = new TextInputBuilder()
        .setCustomId("field_doswiadczenie")
        .setLabel("Czy masz doświadczenie? Jeśli tak, jakie?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
        .setPlaceholder("Opisz swoje doświadczenie lub napisz 'Nie mam doświadczenia'...");

      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(wiekInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(dlaczegoInput),
        new ActionRowBuilder<TextInputBuilder>().addComponents(doswiadczenieInput),
      );

      await btn.showModal(modal);
      return;
    }

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

const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const { MongoClient, ServerApiVersion } = require('mongodb');

// MongoDB connection string
const uri = "mongodb+srv://vannydev:vannydev@discordbot.h8kf8yl.mongodb.net/?retryWrites=true&w=majority&appName=DiscordBot";

// Create MongoDB client
const mongoClient = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Discord bot client
const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ] 
});

// Database and collection names
const DB_NAME = "botSettings";
const SETTINGS_COLLECTION = "settings";

// Bot prefix
const PREFIX = "w!";

// Connect to MongoDB
async function connectToMongo() {
  try {
    await mongoClient.connect();
    console.log("Connected to MongoDB!");
    
    // Ensure indexes and default settings exist
    const db = mongoClient.db(DB_NAME);
    const settingsCollection = db.collection(SETTINGS_COLLECTION);
    
    // Create indexes
    await settingsCollection.createIndex({ guildId: 1 }, { unique: true });
    
    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

// Get guild settings
async function getGuildSettings(guildId) {
  const db = mongoClient.db(DB_NAME);
  const settingsCollection = db.collection(SETTINGS_COLLECTION);
  
  let settings = await settingsCollection.findOne({ guildId });
  
  // If no settings exist for this guild, create default settings
  if (!settings) {
    settings = {
      guildId,
      isShutdown: false,
      botChannels: [],
      lastUpdated: new Date()
    };
    
    await settingsCollection.insertOne(settings);
  }
  
  return settings;
}

// Update guild settings
async function updateGuildSettings(guildId, updates) {
  const db = mongoClient.db(DB_NAME);
  const settingsCollection = db.collection(SETTINGS_COLLECTION);
  
  await settingsCollection.updateOne(
    { guildId },
    { $set: { ...updates, lastUpdated: new Date() } },
    { upsert: true }
  );
}

// Check if command can be executed
async function canExecuteCommand(message, commandName) {
  // Always allow these administrative commands
  const alwaysAllowedCommands = ['shutdown', 'poweron', 'setup', 'status', 'listchannels'];
  
  if (alwaysAllowedCommands.includes(commandName)) {
    // Check if user is an admin for these commands
    return message.member.permissions.has(PermissionsBitField.Flags.Administrator);
  }
  
  // For other commands, check if bot is shutdown
  const settings = await getGuildSettings(message.guild.id);
  
  if (settings.isShutdown) {
    // If bot is shutdown, check if the channel is in botChannels
    return settings.botChannels.includes(message.channel.id);
  }
  
  // If not shutdown, allow everywhere
  return true;
}

// Command handlers
const commands = {
  // Shutdown command - disables commands in all channels except bot channels
  async shutdown(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You need administrator permissions to use this command.");
    }
    
    await updateGuildSettings(message.guild.id, { isShutdown: true });
    message.reply("Bot commands have been shut down in all channels except designated bot channels.");
  },
  
  // Power on command - enables commands in all channels
  async poweron(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You need administrator permissions to use this command.");
    }
    
    await updateGuildSettings(message.guild.id, { isShutdown: false });
    message.reply("Bot commands have been enabled in all channels.");
  },
  
  // Setup command - configure bot channels
  async setup(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You need administrator permissions to use this command.");
    }
    
    if (args.length === 0) {
      return message.reply("Please specify channels to use for bot commands when the bot is shut down. Usage: `w!setup #channel1 #channel2 ...`");
    }
    
    const channelIds = [];
    
    // Parse channel mentions or IDs
    for (const arg of args) {
      let channelId = arg;
      
      // Extract ID from channel mention
      if (arg.startsWith('<#') && arg.endsWith('>')) {
        channelId = arg.slice(2, -1);
      }
      
      // Verify the channel exists
      const channel = message.guild.channels.cache.get(channelId);
      if (channel) {
        channelIds.push(channelId);
      }
    }
    
    if (channelIds.length === 0) {
      return message.reply("No valid channels were specified.");
    }
    
    await updateGuildSettings(message.guild.id, { botChannels: channelIds });
    
    // Format the channel list for display
    const channelMentions = channelIds.map(id => `<#${id}>`).join(", ");
    message.reply(`Bot channels have been set to: ${channelMentions}`);
  },
  
  // Status command - show current bot status
  async status(message, args) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply("You need administrator permissions to use this command.");
    }
    
    const settings = await getGuildSettings(message.guild.id);
    const status = settings.isShutdown ? "Shutdown" : "Active";
    
    let reply = `Bot Status: **${status}**\n`;
    
    if (settings.botChannels.length > 0) {
      const channelMentions = settings.botChannels.map(id => `<#${id}>`).join(", ");
      reply += `Bot Channels: ${channelMentions}`;
    } else {
      reply += "No bot channels have been set up.";
    }
    
    message.reply(reply);
  },

  // List Channels command - show designated bot channels
  async listchannels(message, args) {
    // Get guild settings
    const settings = await getGuildSettings(message.guild.id);
    
    if (settings.botChannels.length === 0) {
      return message.reply("No bot channels have been designated yet. Administrators can set them using `w!setup`.");
    }
    
    // Format the channel list for display
    const channelMentions = settings.botChannels.map(id => `<#${id}>`).join(", ");
    
    // Create the response
    let reply = `**Designated Bot Channels:**\n${channelMentions}\n\n`;
    
    // Add status information
    const status = settings.isShutdown ? "Shutdown" : "Active";
    reply += `Bot Status: **${status}**`;
    if (settings.isShutdown) {
      reply += "\n(Commands only work in designated channels when bot is shutdown)";
    } else {
      reply += "\n(Commands work in all channels because the bot is powered on)";
    }
    
    message.reply(reply);
  }
};

// Message handler
client.on('messageCreate', async message => {
  // Ignore messages from bots
  if (message.author.bot) return;
  
  // Check if message starts with prefix
  if (!message.content.startsWith(PREFIX)) return;
  
  // Parse command and arguments
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const commandName = args.shift().toLowerCase();
  
  // Check if command exists
  if (!commands[commandName]) return;
  
  try {
    // Check if command can be executed in this channel
    const canExecute = await canExecuteCommand(message, commandName);
    
    if (!canExecute) {
      // If the bot is shutdown and this isn't a bot channel, ignore silently
      const settings = await getGuildSettings(message.guild.id);
      if (settings.isShutdown && !settings.botChannels.includes(message.channel.id)) {
        return; // Silent ignore - no response
      }
      
      return message.reply("You don't have permission to use this command in this channel.");
    }
    
    // Execute command
    await commands[commandName](message, args);
  } catch (error) {
    console.error(`Error executing command ${commandName}:`, error);
    message.reply("An error occurred while executing the command.");
  }
});

// Ready event
client.once('ready', async () => {
  //console.log(`Logged in as ${client.user.tag}!`);
  
  // Connect to MongoDB
  const connected = await connectToMongo();
  if (!connected) {
    console.error("Failed to connect to MongoDB. Some features may not work correctly.");
  }
});

// Login to Discord
client.login(process.env.TOKEN);

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await mongoClient.close();
  process.exit(0);
});
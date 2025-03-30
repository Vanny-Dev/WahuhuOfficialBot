const { Client, GatewayIntentBits, Events, PermissionsBitField, ChannelType, EmbedBuilder } = require('discord.js');
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ]
});

// Store AFK users with their original voice channel and reason
const afkUsers = new Map();

// Configuration
const CONFIG = {
  AFK_CHANNEL_NAME: 'AFK Room',
  AFK_CATEGORY_NAME: 'LESGO',
  DELETE_EMPTY_DELAY: 3000, // 60 seconds (60000ms) after channel becomes empty
  COMMAND_PREFIX: '!afk'
};

// Track channels scheduled for deletion
const deletionTimers = new Map();

// Create or find the AFK category in a guild
async function getOrCreateAfkCategory(guild) {
  let category = guild.channels.cache.find(
    channel => channel.name === CONFIG.AFK_CATEGORY_NAME && 
               channel.type === ChannelType.GuildCategory
  );
  
  if (!category) {
    try {
      category = await guild.channels.create({
        name: CONFIG.AFK_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        reason: 'Creating category for AFK channels'
      });
      console.log(`Created AFK category in ${guild.name}`);
    } catch (error) {
      console.error(`Failed to create AFK category in ${guild.name}:`, error);
      return null;
    }
  }
  
  return category;
}

// Create or find the AFK channel in a guild
async function getOrCreateAfkChannel(guild) {
  // Try to find existing AFK channel
  let afkChannel = guild.channels.cache.find(
    channel => channel.name === CONFIG.AFK_CHANNEL_NAME && 
               channel.type === ChannelType.GuildVoice
  );
  
  // If already exists, return it
  if (afkChannel) {
    // Cancel any pending deletion
    if (deletionTimers.has(afkChannel.id)) {
      clearTimeout(deletionTimers.get(afkChannel.id));
      deletionTimers.delete(afkChannel.id);
    }
    return afkChannel;
  }
  
  // Get or create the category
  const category = await getOrCreateAfkCategory(guild);
  if (!category) return null;
  
  // Create AFK channel
  try {
    afkChannel = await guild.channels.create({
      name: CONFIG.AFK_CHANNEL_NAME,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionsBitField.Flags.Speak,     // Prevent speaking
            PermissionsBitField.Flags.Connect,   // Prevent anyone from joining
            PermissionsBitField.Flags.UseVAD,    // Prevent using voice activity
          ],
          allow: [
            PermissionsBitField.Flags.Stream     // Allow camera/streaming
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.Connect,   // Allow bot to connect
            PermissionsBitField.Flags.MoveMembers // Allow bot to move members
          ]
        }
      ],
      reason: 'Creating AFK voice channel'
    });
    console.log(`Created AFK channel in ${guild.name}`);
    return afkChannel;
  } catch (error) {
    console.error(`Failed to create AFK channel in ${guild.name}:`, error);
    return null;
  }
}

// Schedule a channel for deletion if empty
function scheduleChannelDeletion(channel) {
  // Cancel any existing timer for this channel
  if (deletionTimers.has(channel.id)) {
    clearTimeout(deletionTimers.get(channel.id));
  }
  
  // Set new timer
  const timer = setTimeout(async () => {
    try {
      // Check if the channel is still empty before deleting
      if (channel.members.size === 0) {
        await channel.delete('AFK channel was empty');
        console.log(`Deleted empty AFK channel in ${channel.guild.name}`);
      }
      deletionTimers.delete(channel.id);
    } catch (error) {
      console.error('Error deleting empty AFK channel:', error);
    }
  }, CONFIG.DELETE_EMPTY_DELAY);
  
  deletionTimers.set(channel.id, timer);
}

// Format time duration
function formatDuration(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  
  // Setup AFK channels in all guilds
  client.guilds.cache.forEach(async (guild) => {
    const afkChannel = await getOrCreateAfkChannel(guild);
    
    // Schedule deletion if channel is empty
    if (afkChannel && afkChannel.members.size === 0) {
      scheduleChannelDeletion(afkChannel);
    }
  });
});

// Handle AFK command
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  
  // Parse command
  if (message.content.toLowerCase().startsWith(CONFIG.COMMAND_PREFIX)) {
    // Extract reason if provided
    const parts = message.content.split(' ');
    let reason = '';
    
    if (parts.length > 1) {
      reason = parts.slice(1).join(' ');
    }
    
    // Get the member
    const member = message.member;
    
    // Check if the member is in a voice channel
    if (!member.voice.channel) {
      return message.reply('You need to be in a voice channel to use the AFK command.');
    }
    
    // Check if already AFK
    if (afkUsers.has(member.id)) {
      return message.reply('You are already marked as AFK!');
    }
    
    try {
      // Get or create the AFK channel
      const afkChannel = await getOrCreateAfkChannel(message.guild);
      
      if (!afkChannel) {
        return message.reply('Could not find or create an AFK voice channel. Please contact an administrator.');
      }
      
      // Store user's original voice channel and reason
      afkUsers.set(member.id, {
        originalChannel: member.voice.channelId,
        reason: reason || 'No reason provided',
        timestamp: Date.now(),
        username: member.user.username
      });
      
      // Grant temporary permission to join the AFK channel
      await afkChannel.permissionOverwrites.create(member, {
        Connect: true,
        Stream: true
      }, { reason: 'Granting temporary AFK access' });
      
      // Move user to AFK channel
      await member.voice.setChannel(afkChannel);
      
      // Confirm AFK status
      const embed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('AFK Status Activated')
        .setDescription(`${member.user.username} is now AFK.`)
        .addFields({ name: 'Reason', value: reason || 'No reason provided' })
        .setTimestamp();
      
      message.reply({ embeds: [embed] });
      
    } catch (error) {
      console.error('Error setting AFK status:', error);
      message.reply('Failed to move you to the AFK channel. The bot might be missing permissions.');
    }
    return;
  }
  
  // Check for mentions of AFK users
  if (message.mentions.users.size > 0) {
    const mentionedAfkUsers = [];
    
    // Check each mentioned user
    for (const [userId, user] of message.mentions.users) {
      if (afkUsers.has(userId)) {
        const afkInfo = afkUsers.get(userId);
        const afkDuration = formatDuration(Date.now() - afkInfo.timestamp);
        
        mentionedAfkUsers.push({
          username: user.username,
          reason: afkInfo.reason,
          duration: afkDuration
        });
      }
    }
    
    // If any mentioned users are AFK, send a notification
    if (mentionedAfkUsers.length > 0) {
      const embed = new EmbedBuilder()
        .setColor('#FF9900')
        .setTitle('⚠️ AFK User Mentioned')
        .setDescription('You mentioned users who are currently AFK:')
        .setTimestamp();
      
      mentionedAfkUsers.forEach(user => {
        embed.addFields({ 
          name: user.username, 
          value: `**Reason:** ${user.reason}\n**AFK for:** ${user.duration}` 
        });
      });
      
      await message.reply({ embeds: [embed] });
    }
  }
});

// Listen for voice state updates
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  // Get guild and channel info
  const guild = oldState.guild || newState.guild;
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const userId = oldState.member.id;
  
  // Get the AFK channel (if it exists)
  const afkChannel = guild.channels.cache.find(
    channel => channel.name === CONFIG.AFK_CHANNEL_NAME && 
               channel.type === ChannelType.GuildVoice
  );
  
  // If there's no AFK channel, nothing to do
  if (!afkChannel) return;
  
  // CASE 1: User left the AFK channel
  if (afkUsers.has(userId) && oldChannelId === afkChannel.id && newChannelId !== afkChannel.id) {
    const userData = afkUsers.get(userId);
    
    // Calculate time spent AFK
    const afkTime = Date.now() - userData.timestamp;
    const formattedTime = formatDuration(afkTime);
    
    // Remove AFK status
    afkUsers.delete(userId);
    
    // Remove the special permission
    try {
      await afkChannel.permissionOverwrites.delete(userId, 'User is no longer AFK');
    } catch (error) {
      console.error('Error removing permissions:', error);
    }
    
    // Notify user via DM
    try {
      await oldState.member.send(
        `Welcome back! You are no longer AFK. You were AFK for ${formattedTime}.`
      );
    } catch (error) {
      console.log(`Could not send DM to user ${oldState.member.user.tag}`);
    }
    
    // Find a general channel to announce return
    try {
      const generalChannel = guild.channels.cache.find(
        channel => (channel.name.includes('audit-logs') /*|| channel.name.includes('chat')*/ ) && 
                   channel.type === ChannelType.GuildText
      );
      
      if (generalChannel) {
        const embed = new EmbedBuilder()
          .setColor('#2ecc71')
          .setTitle('User Returned')
          .setDescription(`${oldState.member.user.username} is no longer AFK`)
          .addFields({ name: 'AFK Duration', value: formattedTime })
          .setTimestamp();
        
        await generalChannel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.log('Could not send return notification:', error);
    }
  }
  
  // CASE 2: Check if AFK channel is now empty and schedule for deletion if so
  if (afkChannel && (oldChannelId === afkChannel.id || newChannelId === afkChannel.id)) {
    // If channel is now empty, schedule it for deletion
    if (afkChannel.members.size === 0) {
      scheduleChannelDeletion(afkChannel);
    } 
    // If someone joined, cancel any pending deletion
    else if (deletionTimers.has(afkChannel.id)) {
      clearTimeout(deletionTimers.get(afkChannel.id));
      deletionTimers.delete(afkChannel.id);
    }
  }
});

// Handle new server joins
client.on(Events.GuildCreate, async (guild) => {
  const afkChannel = await getOrCreateAfkChannel(guild);
  
  // Schedule deletion if channel is empty
  if (afkChannel && afkChannel.members.size === 0) {
    scheduleChannelDeletion(afkChannel);
  }
});

// Clean up when the bot shuts down
process.on('SIGINT', () => {
  console.log('Bot shutting down, clearing timers...');
  
  // Clear all deletion timers
  for (const [channelId, timer] of deletionTimers.entries()) {
    clearTimeout(timer);
  }
  
  process.exit(0);
});

// Replace 'YOUR_TOKEN' with your actual Discord bot token
client.login(process.env.TOKEN);  
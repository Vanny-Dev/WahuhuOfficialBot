const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, getVoiceConnection } = require('@discordjs/voice');
const { MongoClient } = require('mongodb');
const { Innertube } = require('youtubei.js');
const fs = require('fs');
const path = require('path');

// Bot configuration
const prefix = 'w!';
const token = process.env.TOKEN;
const mongoUri = 'mongodb+srv://vannydev:vannydev@discordbot.h8kf8yl.mongodb.net/?retryWrites=true&w=majority&appName=DiscordBot';

// Create a new Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Global variables for music playback
const queues = new Map(); // Server-specific queues

// Initialize YouTube client
let youtube;
const initYouTube = async () => {
  try {
    youtube = await Innertube.create({
      // Set explicit timeout to avoid negative timeout errors
      fetch_options: {
        timeout: 30000 // 30 seconds
      }
    });
    console.log('YouTube client initialized');
  } catch (error) {
    console.error('Failed to initialize YouTube client:', error);
    // Try to reinitialize after a delay
    setTimeout(initYouTube, 5000);
  }
};

// MongoDB connection
let db;
const connectToMongo = async () => {
  try {
    const mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    db = mongoClient.db('musicbot');
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    // Don't exit process, try to continue without MongoDB
    return null;
  }
};

// Function to save play history to MongoDB
async function saveToHistory(guildId, title, url, requestedBy) {
  if (!db) return; // Skip if MongoDB is not connected
  
  try {
    const collection = db.collection('playHistory');
    await collection.insertOne({
      guildId,
      title,
      url,
      requestedBy,
      playedAt: new Date()
    });
    console.log('Song saved to history');
  } catch (err) {
    console.error('Error saving to MongoDB:', err);
  }
}

// Function to get server queue
function getServerQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      textChannel: null,
      voiceChannel: null,
      connection: null,
      player: null,
      songs: [],
      playing: true,
      paused: false
    });
  }
  return queues.get(guildId);
}

// Function to play the next song in the queue
async function playNextSong(message, guildId) {
  const queue = getServerQueue(guildId);
  
  if (queue.songs.length === 0) {
    // No more songs in the queue
    if (queue.connection) {
      setTimeout(() => {
        if (queue.connection) {
          queue.connection.destroy();
        }
        queues.delete(guildId);
      }, 5000); // Wait 5 seconds before disconnecting
    }
    return;
  }
  
  const song = queue.songs.shift(); // Get the first song from the queue
  
  try {
    // Create player if it doesn't exist
    if (!queue.player) {
      queue.player = createAudioPlayer();
      
      // Set up player event listeners
      queue.player.on(AudioPlayerStatus.Idle, () => {
        playNextSong(message, guildId);
      });
      
      queue.player.on('error', error => {
        console.error('Audio player error:', error);
        playNextSong(message, guildId);
      });
    }
    
    // Ensure we have a connection
    if (!queue.connection && queue.voiceChannel) {
      queue.connection = joinVoiceChannel({
        channelId: queue.voiceChannel.id,
        guildId: guildId,
        adapterCreator: queue.voiceChannel.guild.voiceAdapterCreator
      });
      
      queue.connection.subscribe(queue.player);
    }
    
    // Get song details
    const info = await youtube.getBasicInfo(song.videoId);
    const format = info.chooseFormat({ type: 'audio', quality: '360p' });
    
    if (!format) {
      console.error('No suitable audio format found');
      queue.textChannel.send('❌ Error: No suitable audio format found for this song.');
      return playNextSong(message, guildId);
    }
    
    const audioUrl = format.decipher(youtube.session.player);
    const resource = createAudioResource(audioUrl);
    
    queue.player.play(resource);
    queue.playing = true;
    queue.paused = false;
    
    // Create Now Playing embed
    const durationText = info.basic_info.duration ? formatDuration(info.basic_info.duration) : 'Unknown';
    const artistName = info.basic_info.author || 'Unknown Artist';
    const thumbnailUrl = info.basic_info.thumbnail ? info.basic_info.thumbnail[0].url : null;
    
    const embed = new EmbedBuilder()
      .setTitle('🎶 **Now Playing** 🎶')
      .setDescription(`**Song:** ${song.title}\n**Artist:** ${artistName}\n**Duration:** ${durationText}`)
      .setColor('#FF4500');
    
    if (thumbnailUrl) {
      embed.setImage(thumbnailUrl);
    }
    
    embed.addFields(
      { name: '🎧 Audio Quality', value: 'High', inline: true },
      { name: '⏯️ Current Status', value: 'Playing', inline: true }
    )
    .setFooter({ text: 'Wahuhuu Music Bot', iconURL: 'https://i.ibb.co/m4tjmrk/Screenshot-2024-11-25-074857.png' })
    .setTimestamp();
    
    // Create control buttons
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('stop')
          .setLabel('Stop')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('pause')
          .setLabel(queue.paused ? 'Resume' : 'Pause')
          .setStyle(queue.paused ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId('skip')
          .setLabel('Skip')
          .setStyle(ButtonStyle.Primary)
      );
    
    // Send the embed to the text channel
    queue.textChannel.send({ embeds: [embed], components: [row] });
    
    // Save to MongoDB if connected
    if (song.requestedBy) {
      await saveToHistory(guildId, song.title, `https://www.youtube.com/watch?v=${song.videoId}`, song.requestedBy);
    }
    
  } catch (error) {
    console.error('Error playing song:', error);
    queue.textChannel.send(`❌ Error playing song: ${error.message}`);
    playNextSong(message, guildId);
  }
}

// Utility function to format duration
function formatDuration(seconds) {
  if (!seconds) return 'Unknown';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

// When the bot is ready
client.once('ready', async () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);
  await connectToMongo();
  await initYouTube();
});

// Handle messages
client.on('messageCreate', async message => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;
  
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  
  // Check if user is in a voice channel for music commands
  if (['play', 'stop', 'pause', 'skip'].includes(command) && !message.member.voice.channel) {
    return message.channel.send('❌ You need to be in a voice channel to use this command!');
  }
  
  // Handle commands
  try {
    switch (command) {
      case 'play':
        await handlePlay(message, args);
        break;
      case 'stop':
        await handleStop(message);
        break;
      case 'pause':
        await handlePause(message);
        break;
      case 'skip':
        await handleSkip(message);
        break;
      case 'queue':
        await handleQueue(message);
        break;
      case 'history':
        await handleHistory(message);
        break;
      case 'help':
        await handleHelp(message);
        break;
    }
  } catch (error) {
    console.error(`Error handling command ${command}:`, error);
    message.channel.send(`❌ An error occurred: ${error.message}`);
  }
});

// Handle button interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  
  const { customId, guildId } = interaction;
  const queue = getServerQueue(guildId);
  
  if (!queue) {
    return interaction.reply({
      content: '❌ No active music playback.',
      ephemeral: true
    });
  }
  
  switch (customId) {
    case 'stop':
      queue.songs = [];
      if (queue.player) queue.player.stop();
      if (queue.connection) queue.connection.destroy();
      queues.delete(guildId);
      await interaction.reply('⏹️ Music playback stopped and queue cleared!');
      break;
      
    case 'pause':
      if (!queue.player) {
        return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
      }
      
      if (queue.paused) {
        queue.player.unpause();
        queue.paused = false;
        await interaction.reply('▶️ Resumed the music!');
      } else {
        queue.player.pause();
        queue.paused = true;
        await interaction.reply('⏸️ Paused the music!');
      }
      
      // Update the button
      if (interaction.message) {
        const row = ActionRowBuilder.from(interaction.message.components[0]);
        
        // Find and update the pause button
        const pauseButton = row.components.find(c => c.customId === 'pause');
        if (pauseButton) {
          pauseButton.setLabel(queue.paused ? 'Resume' : 'Pause');
          pauseButton.setStyle(queue.paused ? ButtonStyle.Primary : ButtonStyle.Secondary);
        }
        
        await interaction.message.edit({ components: [row] });
      }
      break;
      
    case 'skip':
      if (!queue.player) {
        return interaction.reply({ content: '❌ Nothing is playing right now.', ephemeral: true });
      }
      
      await interaction.reply('⏭️ Skipped to the next song!');
      queue.player.stop(); // This will trigger the 'idle' event which will play the next song
      break;
  }
});

// Command handlers
async function handlePlay(message, args) {
  if (!args.length) {
    return message.channel.send('❌ Please provide a song title or YouTube URL!');
  }
  
  const query = args.join(' ');
  const voiceChannel = message.member.voice.channel;
  const queue = getServerQueue(message.guild.id);
  
  // Set voice channel and text channel
  queue.voiceChannel = voiceChannel;
  queue.textChannel = message.channel;
  
  const loadingMsg = await message.channel.send('🔍 Searching for your song...');
  
  try {
    let videoId, title, thumbnails;
    
    // Check if it's a YouTube URL
    const ytUrlPattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})$/;
    const match = query.match(ytUrlPattern);
    
    if (match) {
      videoId = match[4];
      const info = await youtube.getBasicInfo(videoId);
      title = info.basic_info.title;
      thumbnails = info.basic_info.thumbnail;
    } else {
      // Search for the video
      const searchResults = await youtube.search(query, { type: 'video' });
      
      if (!searchResults || !searchResults.videos || searchResults.videos.length === 0) {
        await loadingMsg.delete().catch(console.error);
        return message.channel.send('❌ No results found for your search query.');
      }
      
      const video = searchResults.videos[0];
      videoId = video.id;
      title = video.title;
      thumbnails = video.thumbnails;
    }
    
    if (!videoId) {
      await loadingMsg.delete().catch(console.error);
      return message.channel.send('❌ Could not find a valid video.');
    }
    
    // Add to queue
    queue.songs.push({
      title,
      videoId,
      thumbnailUrl: thumbnails && thumbnails.length > 0 ? thumbnails[0].url : null,
      requestedBy: message.author.tag
    });
    
    // Create embed for queue addition
    const embed = new EmbedBuilder()
      .setTitle('✅ Song Added to Queue')
      .setDescription(`Added **${title}** to the queue.`)
      .setColor('#32CD32');
    
    if (thumbnails && thumbnails.length > 0) {
      embed.setThumbnail(thumbnails[0].url);
    }
    
    await loadingMsg.edit({ content: null, embeds: [embed] });
    
    // Start playing if not already
    if (!queue.playing || !queue.player || queue.player.state.status === AudioPlayerStatus.Idle) {
      await playNextSong(message, message.guild.id);
    }
    
  } catch (error) {
    console.error('Error adding song to queue:', error);
    await loadingMsg.edit(`❌ Error: ${error.message}`);
  }
}

async function handleStop(message) {
  const queue = getServerQueue(message.guild.id);
  
  if (!queue.player) {
    return message.channel.send('❌ Nothing is playing right now.');
  }
  
  queue.songs = [];
  queue.player.stop();
  
  if (queue.connection) {
    queue.connection.destroy();
  }
  
  queues.delete(message.guild.id);
  
  message.channel.send('⏹️ Music playback stopped and queue cleared!');
}

async function handlePause(message) {
  const queue = getServerQueue(message.guild.id);
  
  if (!queue.player || queue.player.state.status !== AudioPlayerStatus.Playing && !queue.paused) {
    return message.channel.send('❌ Nothing is playing right now.');
  }
  
  if (queue.paused) {
    queue.player.unpause();
    queue.paused = false;
    message.channel.send('▶️ Resumed the music!');
  } else {
    queue.player.pause();
    queue.paused = true;
    message.channel.send('⏸️ Paused the music!');
  }
}

async function handleSkip(message) {
  const queue = getServerQueue(message.guild.id);
  
  if (!queue.player) {
    return message.channel.send('❌ Nothing is playing right now.');
  }
  
  message.channel.send('⏭️ Skipped to the next song!');
  queue.player.stop(); // This will trigger the 'idle' event which will play the next song
}

async function handleQueue(message) {
  const queue = getServerQueue(message.guild.id);
  
  if (!queue || queue.songs.length === 0) {
    return message.channel.send('❌ The queue is empty.');
  }
  
  const embed = new EmbedBuilder()
    .setTitle('🎵 Song Queue')
    .setColor('#9400D3')
    .setTimestamp();
  
  // Add up to 10 songs from the queue
  let description = '';
  const songList = [...queue.songs];
  const totalSongs = songList.length;
  
  for (let i = 0; i < Math.min(totalSongs, 10); i++) {
    const song = songList[i];
    description += `${i + 1}. **${song.title}** (Requested by: ${song.requestedBy})\n`;
  }
  
  if (totalSongs > 10) {
    description += `\n...and ${totalSongs - 10} more songs`;
  }
  
  embed.setDescription(description);
  message.channel.send({ embeds: [embed] });
}

async function handleHistory(message) {
  if (!db) {
    return message.channel.send('❌ Song history is not available (database not connected).');
  }
  
  const loadingMsg = await message.channel.send('📜 Fetching song history...');
  
  try {
    const collection = db.collection('playHistory');
    const history = await collection.find({ guildId: message.guild.id })
      .sort({ playedAt: -1 })
      .limit(10)
      .toArray();
    
    if (history.length === 0) {
      return loadingMsg.edit('No song history available for this server.');
    }
    
    const embed = new EmbedBuilder()
      .setTitle('🎵 Recently Played Songs')
      .setColor('#4B0082')
      .setTimestamp();
    
    let description = '';
    history.forEach((song, index) => {
      const date = new Date(song.playedAt).toLocaleString();
      description += `${index + 1}. **${song.title}** (Requested by: ${song.requestedBy}, Played: ${date})\n`;
    });
    
    embed.setDescription(description);
    await loadingMsg.edit({ content: null, embeds: [embed] });
    
  } catch (error) {
    console.error('Error retrieving song history:', error);
    await loadingMsg.edit(`❌ Error retrieving song history: ${error.message}`);
  }
}

async function handleHelp(message) {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Wahuhuu Music Bot Commands')
    .setColor('#00BFFF')
    .setDescription('Here are the available commands:')
    .addFields(
      { name: `${prefix}play <title or URL>`, value: 'Play a song from YouTube', inline: false },
      { name: `${prefix}stop`, value: 'Stop playing and clear the queue', inline: true },
      { name: `${prefix}pause`, value: 'Pause or resume the current song', inline: true },
      { name: `${prefix}skip`, value: 'Skip to the next song', inline: true },
      { name: `${prefix}queue`, value: 'Show the current song queue', inline: true },
      { name: `${prefix}history`, value: 'Show recently played songs', inline: true },
      { name: `${prefix}help`, value: 'Show this help message', inline: true }
    )
    .setFooter({ text: 'Prefix: w!' });
  
  message.channel.send({ embeds: [embed] });
}

// Login to Discord
client.login(token);
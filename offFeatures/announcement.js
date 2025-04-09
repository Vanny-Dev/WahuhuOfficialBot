// Discord Announcement Bot with Text Commands and Modal Inputs
// This bot creates visually appealing announcements in Discord servers without slash commands

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    PermissionsBitField,
    Events
  } = require('discord.js');
  const dotenv = require('dotenv');
  
  // Load environment variables
  dotenv.config();
  
  // Create a new client instance with message content intent
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages
    ]
  });
  
  // Bot token and prefix from environment variables
  //const TOKEN = process.env.DISCORD_BOT_TOKEN;
  const PREFIX = process.env.COMMAND_PREFIX || '?'; // Default to ? if not specified
  
  // Command cooldown to prevent spam (in milliseconds)
  const COOLDOWN = 3000;
  const cooldowns = new Map();
  
  // When the bot is ready
  client.once('ready', () => {
    //console.log(`📣 Announcement Bot is online as ${client.user.tag}`);
    
    // Set bot activity status
    client.user.setActivity(`${PREFIX}announce`, { type: 'LISTENING' });
  });
  
  // Handle regular text commands
  client.on(Events.MessageCreate, async (message) => {
    // Ignore messages from bots or messages that don't start with the prefix
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  
    // Parse the command
    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const command = args.shift().toLowerCase();
  
    // Handle the announce command
    if (command === 'announce' || command === 'a') {
      // Check if user has permission to manage messages
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply('❌ You need the "Manage Messages" permission to use this command.');
      }
  
      // Check cooldown
      if (cooldowns.has(message.author.id)) {
        const timeLeft = (cooldowns.get(message.author.id) - Date.now()) / 1000;
        if (timeLeft > 0) {
          return message.reply(`Please wait ${timeLeft.toFixed(1)} more seconds before using this command again.`);
        }
      }
  
      // Set cooldown
      cooldowns.set(message.author.id, Date.now() + COOLDOWN);
      setTimeout(() => cooldowns.delete(message.author.id), COOLDOWN);
  
      try {
        // Send instruction embed
        const helpEmbed = new EmbedBuilder()
          .setTitle('📝 Creating an Announcement')
          .setDescription('Click the button below to open the announcement form.')
          .setColor('#3498db')
          .addFields(
            { name: 'Need help?', value: `Type \`${PREFIX}help\` for more information.` }
          );
  
        // Create button for opening the modal
        const actionRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('openAnnouncementForm')
              .setLabel('Create Announcement')
              .setStyle(ButtonStyle.Primary)
              .setEmoji('📢')
          );
  
        // Send message with button
        await message.reply({ 
          embeds: [helpEmbed], 
          components: [actionRow] 
        });
      } catch (error) {
        console.error('Error with announce command:', error);
        await message.reply('❌ An error occurred while processing your command.');
      }
    } 
    // Handle help command
    else if (command === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('📢 Announcement Bot Help')
        .setDescription('Here are the commands you can use:')
        .setColor('#3498db')
        .addFields(
          { name: `${PREFIX}announce`, value: 'Create a new announcement (alias: `w!a`)' },
          { name: `${PREFIX}help`, value: 'Show this help message' },
          { name: `${PREFIX}channels`, value: 'List all available text channels' },
          { name: `${PREFIX}templates`, value: 'View available announcement templates' }
        )
        .setFooter({ text: 'Need more help? Contact the server admin.' });
  
      await message.reply({ embeds: [helpEmbed] });
    }
    // Handle channels command
    else if (command === 'channels') {
      // List available channels for the user
      const availableChannels = message.guild.channels.cache
        .filter(channel => channel.type === 0) // 0 is GUILD_TEXT
        .map(channel => `#${channel.name}`)
        .join(', ');
      
      const channelsEmbed = new EmbedBuilder()
        .setTitle('📁 Available Text Channels')
        .setDescription(availableChannels)
        .setColor('#3498db');
      
      await message.reply({ embeds: [channelsEmbed] });
    }
    // Handle templates command
    else if (command === 'templates') {
      const templatesEmbed = new EmbedBuilder()
        .setTitle('🎨 Announcement Templates')
        .setDescription('Here are the available templates:')
        .setColor('#3498db')
        .addFields(
          { name: 'Standard', value: 'Basic announcement with title and message' },
          { name: 'Event', value: 'Announcement with date, time, and location fields' },
          { name: 'Update', value: 'Announcement for game/server updates with version number' }
        )
        .setFooter({ text: `Use the template name after ${PREFIX}announce, e.g. "${PREFIX}announce event"` });
  
      await message.reply({ embeds: [templatesEmbed] });
    }
  });
  
  // Handle button interactions
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
  
    // Handle opening the announcement form
    if (interaction.customId === 'openAnnouncementForm') {
      // Create the announcement modal
      const modal = new ModalBuilder()
        .setCustomId('announcementModal')
        .setTitle('Create Announcement');
  
      // Add inputs to the modal
      const titleInput = new TextInputBuilder()
        .setCustomId('titleInput')
        .setLabel('Announcement Title')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter a title for your announcement')
        .setRequired(true)
        .setMaxLength(100);
  
      const messageInput = new TextInputBuilder()
        .setCustomId('messageInput')
        .setLabel('Announcement Message')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Enter the content of your announcement')
        .setRequired(true)
        .setMaxLength(2000);
  
      const colorInput = new TextInputBuilder()
        .setCustomId('colorInput')
        .setLabel('Color (hex code without #)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. FF5733')
        .setRequired(false)
        .setMaxLength(6);
  
      const imageInput = new TextInputBuilder()
        .setCustomId('imageInput')
        .setLabel('Image URL (optional)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://example.com/image.png')
        .setRequired(false);
  
        const channelInput = new TextInputBuilder()
        .setCustomId('channelInput')
        .setLabel('bot-test') // Shortened label
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('announcements (leave empty for current channel)') // Moved instructions here
        .setRequired(false);
  
      // Add inputs to action rows (required for modals)
      const firstRow = new ActionRowBuilder().addComponents(titleInput);
      const secondRow = new ActionRowBuilder().addComponents(messageInput);
      const thirdRow = new ActionRowBuilder().addComponents(colorInput);
      const fourthRow = new ActionRowBuilder().addComponents(imageInput);
      const fifthRow = new ActionRowBuilder().addComponents(channelInput);
  
      // Add action rows to the modal
      modal.addComponents(firstRow, secondRow, thirdRow, fourthRow, fifthRow);
  
      // Show the modal to the user
      await interaction.showModal(modal);
    }
    // Handle reactions to announcements
    else if (interaction.customId === 'like') {
      await interaction.reply({
        content: `${interaction.user} liked this announcement!`,
        ephemeral: true
      });
    } else if (interaction.customId === 'question') {
      // Create modal for question
      const modal = new ModalBuilder()
        .setCustomId('questionModal')
        .setTitle('Ask a Question');
  
      const questionInput = new TextInputBuilder()
        .setCustomId('questionInput')
        .setLabel('Your Question')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type your question here...')
        .setRequired(true)
        .setMaxLength(1000);
  
      const firstActionRow = new ActionRowBuilder().addComponents(questionInput);
      modal.addComponents(firstActionRow);
  
      await interaction.showModal(modal);
    } else if (interaction.customId === 'share') {
      await interaction.reply({
        content: `📨 Share this announcement using this link: ${interaction.message.url}`,
        ephemeral: true
      });
    } else if (interaction.customId === 'confirm') {
      // This is handled in the modal submission collector
    } else if (interaction.customId === 'cancel') {
      // This is handled in the modal submission collector
    }
  });
  
  // Handle modal submissions
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) return;
  
    if (interaction.customId === 'announcementModal') {
      // Get values from the modal
      const title = interaction.fields.getTextInputValue('titleInput');
      const message = interaction.fields.getTextInputValue('messageInput');
      const color = interaction.fields.getTextInputValue('colorInput') || 'FF5733'; // Default color
      const imageUrl = interaction.fields.getTextInputValue('imageInput');
      const channelName = interaction.fields.getTextInputValue('channelInput');
      
      // Determine target channel
      let targetChannel = interaction.channel;
      if (channelName) {
        const foundChannel = interaction.guild.channels.cache.find(
          ch => ch.name.toLowerCase() === channelName.toLowerCase() && ch.type === 0
        );
        
        if (foundChannel) {
          targetChannel = foundChannel;
        } else {
          return interaction.reply({
            content: `❌ Could not find text channel with name "${channelName}". Using current channel instead.`,
            ephemeral: true
          });
        }
      }
  
      // Create the announcement embed
      const announcementEmbed = new EmbedBuilder()
        .setTitle(`📢 ${title}`)
        .setDescription(message)
        .setColor(`#${color}`)
        .setTimestamp()
        .setFooter({ 
          text: `Announcement by ${interaction.user.tag}`, 
          iconURL: interaction.user.displayAvatarURL() 
        });
  
      if (imageUrl && isValidUrl(imageUrl)) {
        announcementEmbed.setImage(imageUrl);
      }
  
      // Create action row with buttons
      const actionRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('like')
            .setLabel('👍 Like')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('question')
            .setLabel('❓ Question')
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId('share')
            .setLabel('🔄 Share')
            .setStyle(ButtonStyle.Success)
        );
  
      try {
        // Send initial response to the modal submission
        await interaction.reply({
          content: 'Here is a preview of your announcement:',
          embeds: [announcementEmbed],
          components: [actionRow],
          ephemeral: true
        });
  
        // Create confirmation buttons
        const confirmRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId('confirm')
              .setLabel('Confirm & Send')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId('cancel')
              .setLabel('Cancel')
              .setStyle(ButtonStyle.Danger)
          );
  
        // Send confirmation message
        const confirmMessage = await interaction.followUp({
          content: `Would you like to post this announcement to #${targetChannel.name}?`,
          components: [confirmRow],
          ephemeral: true
        });
  
        // Create a collector for the confirmation buttons
        const filter = i => i.user.id === interaction.user.id;
        const collector = confirmMessage.createMessageComponentCollector({ 
          filter, 
          time: 60000 
        });
  
        collector.on('collect', async i => {
          if (i.customId === 'confirm') {
            // Send the announcement to the specified channel
            await targetChannel.send({
              embeds: [announcementEmbed],
              components: [actionRow]
            });
  
            await i.update({
              content: `✅ Announcement successfully posted in #${targetChannel.name}!`,
              components: [],
              embeds: []
            });
          } else if (i.customId === 'cancel') {
            await i.update({
              content: '❌ Announcement cancelled.',
              components: [],
              embeds: []
            });
          }
        });
  
        collector.on('end', collected => {
          if (collected.size === 0) {
            interaction.followUp({
              content: '❌ Confirmation timed out. Announcement cancelled.',
              ephemeral: true
            });
          }
        });
      } catch (error) {
        console.error('Error creating announcement:', error);
        await interaction.reply({
          content: '❌ There was an error creating your announcement. Please try again.',
          ephemeral: true
        });
      }
    } else if (interaction.customId === 'questionModal') {
      const question = interaction.fields.getTextInputValue('questionInput');
      
      // Send the question to the channel as a reply to the announcement
      await interaction.message.reply({
        content: `**Question from ${interaction.user}**:\n${question}`
      });
  
      await interaction.reply({
        content: '✅ Your question has been submitted!',
        ephemeral: true
      });
    }
  });
  
  // Utility function to validate URLs
  function isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
  
  // Login to Discord with your client's token
  client.login(process.env.TOKEN);
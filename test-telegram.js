/**
 * Telegram Bot 配置测试脚本
 * 用于验证 Bot Token 和 Chat ID 是否正确配置
 */

// 从命令行参数获取配置
const BOT_TOKEN = process.argv[2];
const CHAT_ID = process.argv[3];

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('用法: node test-telegram.js <BOT_TOKEN> <CHAT_ID>');
  console.error('');
  console.error('示例:');
  console.error('  node test-telegram.js 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11 -1001234567890');
  process.exit(1);
}

async function testTelegramBot() {
  console.log('🔍 测试 Telegram Bot 配置...\n');
  
  // 1. 测试 Bot Token
  console.log('1️⃣ 验证 Bot Token...');
  try {
    const botResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`);
    const botData = await botResponse.json();
    
    if (!botData.ok) {
      console.error('❌ Bot Token 无效');
      console.error('   错误:', botData.description);
      return false;
    }
    
    console.log('✅ Bot Token 有效');
    console.log(`   Bot 名称: ${botData.result.username}`);
    console.log(`   Bot ID: ${botData.result.id}\n`);
  } catch (error) {
    console.error('❌ 无法连接到 Telegram API');
    console.error('   错误:', error.message);
    return false;
  }
  
  // 2. 测试发送消息
  console.log('2️⃣ 测试发送消息到 Chat...');
  try {
    const messageResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: '🧪 Riku-Hub 图床测试消息\n\n如果你看到这条消息，说明配置正确！'
        })
      }
    );
    
    const messageData = await messageResponse.json();
    
    if (!messageData.ok) {
      console.error('❌ 无法发送消息到 Chat');
      console.error('   错误:', messageData.description);
      console.error('\n💡 常见问题:');
      console.error('   - Chat ID 格式错误（群组 ID 通常以 -100 开头）');
      console.error('   - Bot 未加入该群组');
      console.error('   - Bot 在群组中没有发送消息的权限');
      return false;
    }
    
    console.log('✅ 成功发送测试消息');
    console.log(`   消息 ID: ${messageData.result.message_id}\n`);
  } catch (error) {
    console.error('❌ 发送消息失败');
    console.error('   错误:', error.message);
    return false;
  }
  
  // 3. 测试上传文件
  console.log('3️⃣ 测试上传文件...');
  try {
    // 创建一个简单的测试文件
    const testContent = 'Riku-Hub 图床测试文件';
    const blob = new Blob([testContent], { type: 'text/plain' });
    const file = new File([blob], 'test.txt', { type: 'text/plain' });
    
    const formData = new FormData();
    formData.append('chat_id', CHAT_ID);
    formData.append('document', file);
    formData.append('caption', '🧪 测试文件上传');
    
    const uploadResponse = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`,
      {
        method: 'POST',
        body: formData
      }
    );
    
    const uploadData = await uploadResponse.json();
    
    if (!uploadData.ok) {
      console.error('❌ 无法上传文件');
      console.error('   错误:', uploadData.description);
      return false;
    }
    
    console.log('✅ 成功上传测试文件');
    console.log(`   文件 ID: ${uploadData.result.document.file_id}`);
    console.log(`   文件大小: ${uploadData.result.document.file_size} 字节\n`);
  } catch (error) {
    console.error('❌ 上传文件失败');
    console.error('   错误:', error.message);
    return false;
  }
  
  console.log('🎉 所有测试通过！Telegram Bot 配置正确。\n');
  return true;
}

testTelegramBot().then(success => {
  process.exit(success ? 0 : 1);
});

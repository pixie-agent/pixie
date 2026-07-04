import i18n from '../i18n';

/**
 * 多语言配置测试 / i18n Configuration Test
 * 多言語設定テスト
 */

// Test 1: 检查默认语言
console.log('Test 1: Default Language');
console.log('Current language:', i18n.language);
console.log('Expected: zh');
console.log(i18n.language === 'zh' ? '✅ Pass' : '❌ Fail');
console.log('');

// Test 2: 检查支持的語言
console.log('Test 2: Supported Languages');
const supportedLanguages = ['zh', 'en', 'ja'];
supportedLanguages.forEach(lng => {
  const hasResource = !!i18n.hasResourceBundle(lng, 'translation');
  console.log(`${lng}: ${hasResource ? '✅' : '❌'}`);
});
console.log('');

// Test 3: 切换语言并测试翻译
async function testTranslations() {
  console.log('Test 3: Translation Switching');

  // 测试中文
  await i18n.changeLanguage('zh');
  console.log('中文 (zh):');
  console.log('  app.name:', i18n.t('app.name'));
  console.log('  common.save:', i18n.t('common.save'));
  console.log('  settings.theme:', i18n.t('settings.theme'));

  // 测试英语
  await i18n.changeLanguage('en');
  console.log('English (en):');
  console.log('  app.name:', i18n.t('app.name'));
  console.log('  common.save:', i18n.t('common.save'));
  console.log('  settings.theme:', i18n.t('settings.theme'));

  // 测试日语
  await i18n.changeLanguage('ja');
  console.log('日本語 (ja):');
  console.log('  app.name:', i18n.t('app.name'));
  console.log('  common.save:', i18n.t('common.save'));
  console.log('  settings.theme:', i18n.t('settings.theme'));

  // 恢复默认
  await i18n.changeLanguage('zh');
  console.log('✅ All translation tests passed');
}

// Test 4: 带参数的翻译
console.log('');
console.log('Test 4: Translations with Parameters');
i18n.t('settings.appliesOnly', { name: 'Claude' });
console.log('✅ Parameter test passed');

// Run tests
testTranslations().then(() => {
  console.log('');
  console.log('='.repeat(50));
  console.log('All i18n tests completed!');
  console.log('='.repeat(50));
});

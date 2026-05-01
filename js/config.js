(function(PLUGIN_ID) {
  'use strict';

  // 既存の設定を読み込み
  var config = kintone.plugin.app.getConfig(PLUGIN_ID);

  // KUCコンポーネントの初期化: 動作モード
  var operationModeRadio = new Kuc.RadioButton({
    items: [
      { label: '対象アプリ（メンテナンス対象として制御されるアプリ）', value: 'target' },
      { label: '管理アプリ（メンテナンス設定を登録・管理するアプリ）', value: 'manager' }
    ],
    value: config.operationMode || 'target',
    itemLayout: 'vertical'
  });
  document.getElementById('operation-mode-container').appendChild(operationModeRadio);

  // KUCコンポーネントの初期化: テーマ選択
  var themeDropdown = new Kuc.Dropdown({
    items: [
      { label: 'ランダム表示（推奨）', value: 'random' },
      { label: 'Clean White（ホワイト基調）', value: 'white' },
      { label: 'Dark Cyber（サイバー風）', value: 'dark' },
      { label: 'Gradient（グラデーション）', value: 'gradient' }
    ],
    value: config.theme || 'random'
  });
  document.getElementById('theme-select-container').appendChild(themeDropdown);

  // 既存値のセット
  if (config.maintenanceAppId) {
    document.getElementById('maintenance-app-id').value = config.maintenanceAppId;
  }
  if (config.managerSpaceId) {
    document.getElementById('manager-space-id').value = config.managerSpaceId;
  }
  if (config.managerSaveField) {
    document.getElementById('manager-save-field').value = config.managerSaveField;
  }

  // モード切替のUI制御
  function toggleSettings() {
    var mode = operationModeRadio.value;
    if (mode === 'target') {
      document.getElementById('target-app-settings').style.display = 'block';
      document.getElementById('manager-app-settings').style.display = 'none';
    } else {
      document.getElementById('target-app-settings').style.display = 'none';
      document.getElementById('manager-app-settings').style.display = 'block';
    }
  }

  // イベントリスナー
  operationModeRadio.addEventListener('change', toggleSettings);
  toggleSettings(); // 初期表示時の制御

  // 保存ボタンの処理
  document.getElementById('plugin-submit').addEventListener('click', function() {
    var newConfig = {};
    newConfig.operationMode = operationModeRadio.value;

    if (newConfig.operationMode === 'target') {
      var appId = document.getElementById('maintenance-app-id').value;
      if (!appId) {
        alert('メンテナンス管理アプリのアプリIDを入力してください。');
        return;
      }
      newConfig.maintenanceAppId = appId;
      newConfig.theme = themeDropdown.value;
    } else {
      var spaceId = document.getElementById('manager-space-id').value;
      var saveField = document.getElementById('manager-save-field').value;
      if (!spaceId || !saveField) {
        alert('スペースフィールドの要素IDと保存用フィールドコードを入力してください。');
        return;
      }
      newConfig.managerSpaceId = spaceId;
      newConfig.managerSaveField = saveField;
    }

    kintone.plugin.app.setConfig(newConfig);
  });

  // キャンセルボタンの処理
  document.getElementById('plugin-cancel').addEventListener('click', function() {
    history.back();
  });

})(kintone.$PLUGIN_ID);

(function(PLUGIN_ID) {
    'use strict';

    // プラグイン設定の取得
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);

    // 対象アプリモードの場合は manager.js の処理は行わない
    if (config.operationMode !== 'manager') {
        return;
    }

    const spaceId = config.managerSpaceId;
    const saveField = config.managerSaveField;

    if (!spaceId || !saveField) {
        return;
    }

    // 保存時のイベント：開始・終了日時の分を強制的に「00」に丸める、前後関係チェック
    const eventsSubmit = [
        'app.record.create.submit',
        'app.record.edit.submit'
    ];

    kintone.events.on(eventsSubmit, function (event) {
        const record = event.record;

        if (record.Start_Datetime && record.Start_Datetime.value) {
            const startDate = new Date(record.Start_Datetime.value);
            startDate.setMinutes(0);
            startDate.setSeconds(0);
            startDate.setMilliseconds(0);
            record.Start_Datetime.value = startDate.toISOString();
        }

        if (record.End_Datetime && record.End_Datetime.value) {
            const endDate = new Date(record.End_Datetime.value);
            endDate.setMinutes(0);
            endDate.setSeconds(0);
            endDate.setMilliseconds(0);
            record.End_Datetime.value = endDate.toISOString();
        }

        if (record.Start_Datetime && record.Start_Datetime.value && record.End_Datetime && record.End_Datetime.value) {
            if (new Date(record.Start_Datetime.value) >= new Date(record.End_Datetime.value)) {
                event.error = '終了日時は開始日時より後の時間を指定してください。';
            }
        }

        return event;
    });

    const events = [
        'app.record.create.show',
        'app.record.edit.show'
    ];

    let multiChoice = null;

    kintone.events.on(events, function(event) {
        const record = event.record;
        
        // スペース要素の取得
        const spaceElement = kintone.app.record.getSpaceElement(spaceId);
        if (!spaceElement) {
            console.error('指定されたスペース要素が見つかりません: ' + spaceId);
            return event;
        }

        // 保存用フィールドはユーザーが直接編集しないように非活性化（または非表示）にするのが望ましいが、
        // とりあえず非活性化しておく。
        record[saveField].disabled = true;

        // 既存の選択状態をカンマ区切り文字列から配列にする
        const currentValueStr = record[saveField].value || '';
        const selectedValues = currentValueStr.split(',').map(s => s.trim()).filter(Boolean);

        // KUCコンポーネントが既にあれば削除（リロード時対策）
        spaceElement.innerHTML = '';

        const spinner = document.createElement('div');
        spinner.innerText = 'アプリ一覧を読み込み中...';
        spaceElement.appendChild(spinner);

        // 全アプリを取得
        kintone.api(kintone.api.url('/k/v1/apps.json', true), 'GET', {}).then(function(resp) {
            spaceElement.removeChild(spinner);

            const apps = resp.apps || [];
            
            // KUC MultiChoice用のitemsを作成
            const items = apps.map(app => {
                return {
                    label: app.name + ' (ID: ' + app.appId + ')',
                    value: app.appId
                };
            });

            // 選択済みのIDが今のアプリ一覧にない場合は一応残すかどうかの判定が必要だが、
            // 今回は存在するアプリだけとする。
            const validSelectedValues = selectedValues.filter(v => apps.some(a => a.appId === v));

            multiChoice = new Kuc.MultiChoice({
                label: 'メンテナンス対象アプリを選択',
                requiredIcon: false,
                items: items,
                value: validSelectedValues,
                error: ''
            });

            // 値が変わったときに保存用フィールドに反映するためのイベント
            multiChoice.addEventListener('change', function(e) {
                const currentRecord = kintone.app.record.get();
                // 選択された配列をカンマ区切りでフィールドにセット
                currentRecord.record[saveField].value = e.detail.value.join(',');
                kintone.app.record.set(currentRecord);
            });

            spaceElement.appendChild(multiChoice);

        }).catch(function(err) {
            console.error('アプリ一覧の取得に失敗しました', err);
            spinner.innerText = 'アプリ一覧の取得に失敗しました。';
        });

        // -----------------------------------------------------------------
        // デバイス標準の時計UI（datetime-local）の生成処理
        // -----------------------------------------------------------------
        const timePickerSpace = kintone.app.record.getSpaceElement('time_picker_space');
        if (timePickerSpace && !document.getElementById('custom-time-picker-container')) {
            
            const container = document.createElement('div');
            container.id = 'custom-time-picker-container';
            container.style.border = '1px solid #ddd';
            container.style.padding = '15px';
            container.style.backgroundColor = '#fefefe';
            container.style.borderRadius = '8px';
            container.style.marginTop = '10px';
            container.style.display = 'flex';
            container.style.flexDirection = 'column';
            container.style.gap = '15px';

            const notice = document.createElement('div');
            notice.innerHTML = '<span style="color:#e74c3c; font-weight:bold;">【重要】</span>ネイティブ時計で「分」まで選べますが、保存時（および選択直後）に自動的に「毎時00分」に丸められます。';
            notice.style.fontSize = '12px';
            notice.style.backgroundColor = '#fdf2f2';
            notice.style.padding = '8px';
            container.appendChild(notice);

            const createDatetimeUI = function(labelTxt, fieldCode) {
                const wrapper = document.createElement('div');
                
                const label = document.createElement('div');
                label.innerText = labelTxt;
                label.style.marginBottom = '5px';
                label.style.fontWeight = 'bold';
                wrapper.appendChild(label);

                const input = document.createElement('input');
                input.type = 'datetime-local';
                input.style.padding = '8px';
                input.style.border = '1px solid #ccc';
                input.style.borderRadius = '4px';
                input.style.fontSize = '16px';
                input.style.width = '100%';
                input.style.maxWidth = '300px';
                
                // 初回描画時に既存の値をセット
                const currentRecordData = kintone.app.record.get();
                if (currentRecordData.record[fieldCode] && currentRecordData.record[fieldCode].value) {
                    const d = new Date(currentRecordData.record[fieldCode].value);
                    const y = d.getFullYear();
                    const m = ('0' + (d.getMonth() + 1)).slice(-2);
                    const day = ('0' + d.getDate()).slice(-2);
                    const h = ('0' + d.getHours()).slice(-2);
                    input.value = `${y}-${m}-${day}T${h}:00`;
                }

                // 変更イベントで分を00に丸める
                input.addEventListener('change', function(e) {
                    if (!e.target.value) return;
                    
                    const d = new Date(e.target.value);
                    d.setMinutes(0);
                    d.setSeconds(0);
                    
                    const y = d.getFullYear();
                    const m = ('0' + (d.getMonth() + 1)).slice(-2);
                    const day = ('0' + d.getDate()).slice(-2);
                    const h = ('0' + d.getHours()).slice(-2);
                    e.target.value = `${y}-${m}-${day}T${h}:00`;

                    const currentRec = kintone.app.record.get();
                    if(currentRec.record[fieldCode]){
                         currentRec.record[fieldCode].value = d.toISOString();
                         kintone.app.record.set(currentRec);
                    }
                });

                wrapper.appendChild(input);
                return wrapper;
            };

            container.appendChild(createDatetimeUI('▼ 開始日時', 'Start_Datetime'));
            container.appendChild(createDatetimeUI('▼ 終了日時', 'End_Datetime'));

            timePickerSpace.appendChild(container);
        }

        return event;
    });

})(kintone.$PLUGIN_ID);

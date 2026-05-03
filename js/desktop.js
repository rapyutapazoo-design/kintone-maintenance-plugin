(function (PLUGIN_ID) {
    'use strict';

    // プラグイン設定の取得
    const config = kintone.plugin.app.getConfig(PLUGIN_ID);

    // 管理アプリモードの場合は desktop.js のメイン処理（ブロック）は行わない
    if (config.operationMode === 'manager') {
        return;
    }

    const MAINTENANCE_APP_ID = config.maintenanceAppId;
    if (!MAINTENANCE_APP_ID) return;

    const selectedTheme = config.theme || 'random';

    const blockEvents = [
        'app.record.index.show',
        'app.record.detail.show',
        'app.record.create.show',
        'app.record.edit.show',
        'app.report.show',
        'mobile.app.record.index.show',
        'mobile.app.record.detail.show',
        'mobile.app.record.create.show',
        'mobile.app.record.edit.show'
    ];

    let isChecking = false;
    let isBlocked = false;

    // 現在のアプリIDを取得するフォールバック関数（即時実行時はkintoneオブジェクトの初期化前かもしれないため）
    function getCurrentAppId() {
        let appId = kintone.app.getId() || kintone.mobile.app.getId();
        if (appId) return appId;
        const match = window.location.pathname.match(/\/k\/(?:m\/)?(\d+)/);
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        return null;
    }

    // メインの判定・ブロック処理（非同期）
    function checkAndBlockMaintenance() {
        if (isChecking || isBlocked) return Promise.resolve();
        isChecking = true;

        const currentAppId = getCurrentAppId();
        if (!currentAppId) {
            isChecking = false;
            return Promise.resolve();
        }

        const loginUser = kintone.getLoginUser();
        const query = 'Is_Active in ("有効") order by Start_Datetime desc limit 10';

        const fetchMaintenanceRecord = function () {
            return new kintone.Promise(function (resolve, reject) {
                const body = { app: MAINTENANCE_APP_ID, query: query };
                kintone.api(kintone.api.url('/k/v1/records.json', true), 'GET', body, function (resp) {
                    resolve(resp);
                }, function (error) {
                    console.error('メンテナンス管理アプリへのアクセスに失敗しました', error);
                    reject('API Error');
                });
            });
        };

        return fetchMaintenanceRecord().then(function (resp) {
            if (!resp || !resp.records || resp.records.length === 0) return Promise.reject('No Setting');

            let activeRecord = null;
            const now = new Date().getTime();

            for (let i = 0; i < resp.records.length; i++) {
                const rec = resp.records[i];
                const startStr = rec.Start_Datetime ? rec.Start_Datetime.value : '';
                const endStr = rec.End_Datetime ? rec.End_Datetime.value : '';
                
                let targetApps = '';
                if (rec.Target_App_IDs) targetApps = rec.Target_App_IDs.value || '';
                else if (rec.Target_App) targetApps = rec.Target_App.value || '';

                const targetAppArray = targetApps.split(',').map(s => s.trim()).filter(Boolean);
                const isTarget = targetAppArray.length === 0 || targetAppArray.includes(String(currentAppId));

                if (!startStr || !endStr || !isTarget) continue;

                const startTime = new Date(startStr).getTime();
                const endTime = new Date(endStr).getTime();

                if (now >= startTime && now <= endTime) {
                    activeRecord = rec;
                    break;
                }
            }

            if (!activeRecord) {
                return Promise.reject('Not In Period or Not Target');
            }
            return activeRecord;
        }).then(function (record) {
            const bypassUsers = record.Bypass_Users && record.Bypass_Users.value ? record.Bypass_Users.value.map(u => u.code) : [];
            const bypassGroups = record.Bypass_Groups && record.Bypass_Groups.value ? record.Bypass_Groups.value.map(g => g.code) : [];
            const bypassOrgs = record.Bypass_Orgs && record.Bypass_Orgs.value ? record.Bypass_Orgs.value.map(o => o.code) : [];

            if (bypassUsers.includes(loginUser.code)) {
                showAdminNotice();
                return Promise.reject('Allowed By User');
            }

            let groupPromise = kintone.Promise.resolve(false);
            if (bypassGroups.length > 0) {
                groupPromise = kintone.api(kintone.api.url('/v1/user/groups', true), 'GET', { code: loginUser.code }).then(function (groupResp) {
                    const userGroups = groupResp.groups || [];
                    return bypassGroups.some(allowedGroup => userGroups.some(ug => ug.code === allowedGroup));
                });
            }

            let orgPromise = kintone.Promise.resolve(false);
            if (bypassOrgs.length > 0) {
                orgPromise = kintone.api(kintone.api.url('/v1/user/organizations', true), 'GET', { code: loginUser.code }).then(function (orgResp) {
                    const userOrgs = orgResp.organizationTitles || [];
                    return bypassOrgs.some(allowedOrg => userOrgs.some(uo => uo.organization.code === allowedOrg));
                });
            }

            return kintone.Promise.all([groupPromise, orgPromise]).then(function(results) {
                if (results[0] || results[1]) {
                    showAdminNotice();
                    return Promise.reject('Allowed By Group/Org');
                }
                return record;
            });

        }).then(function (record) {
            if (isBlocked) return; // 既にブロックされていれば何もしない
            isBlocked = true;
            
            const startStr = record.Start_Datetime.value;
            const endStr = record.End_Datetime.value;

            const parseDate = function (isoStr) {
                const d = new Date(isoStr);
                return {
                    y: d.getFullYear(),
                    m: ('0' + (d.getMonth() + 1)).slice(-2),
                    d: ('0' + d.getDate()).slice(-2),
                    h: ('0' + d.getHours()).slice(-2),
                    min: ('0' + d.getMinutes()).slice(-2)
                };
            };

            const st = parseDate(startStr);
            const ed = parseDate(endStr);

            let displayPeriod = "";
            if (st.y === ed.y && st.m === ed.m && st.d === ed.d) {
                displayPeriod = st.y + '/' + st.m + '/' + st.d + ' ' + st.h + ':' + st.min + ' 〜 ' + ed.h + ':' + ed.min;
            } else {
                displayPeriod = st.y + '/' + st.m + '/' + st.d + ' ' + st.h + ':' + st.min + ' 〜 ' + ed.y + '/' + ed.m + '/' + ed.d + ' ' + ed.h + ':' + ed.min;
            }

            let customMessage = record.Message ? record.Message.value : '';
            if (customMessage) {
                customMessage = customMessage.replace(/\n/g, '<br>') + '<br><br>';
            }
            const htmlMessage = '現在システムメンテナンスを実施しております。<br>' + customMessage + '完了までしばらくお待ちください。';

            showMaintenanceOverlay(displayPeriod, htmlMessage, selectedTheme);

        }).catch(function (err) {
            const ignoreList = ['No Setting', 'Not In Period or Not Target', 'Allowed By User', 'Allowed By Group/Org'];
            if (!ignoreList.includes(err)) {
                console.error('メンテナンス情報の取得・判定中にエラーが発生しました', err);
            }
        }).finally(function () {
            isChecking = false;
        });
    }

    // --- 堅牢性を高める3段構えのトリガー（トリプル・トリガー） ---

    // 【第1トリガー: 即時実行】
    // イベント発火を待たずに、プラグインファイルが読み込まれた瞬間に判定をスタートする
    checkAndBlockMaintenance();

    // 【第2トリガー: 従来イベント】
    // SPA型の画面遷移などで再度イベントが発生した際にも確実に判定する
    kintone.events.on(blockEvents, function (event) {
        checkAndBlockMaintenance();
        return event;
    });

    // 【第3トリガー: エラー検知フェイルセーフ】
    // 他のJSの構文エラー（ReferenceError等）が原因でkintoneイベントが停止した場合、
    // このエラーキャッチをトリガーにして強制的にメンテナンス判定を走らせる
    window.addEventListener('error', function(e) {
        checkAndBlockMaintenance();
    });
    window.addEventListener('unhandledrejection', function(e) {
        checkAndBlockMaintenance();
    });

    // UI関連関数
    function showAdminNotice() {
        if (document.getElementById('admin-maintenance-notice')) return;
        const notice = document.createElement('div');
        notice.id = 'admin-maintenance-notice';
        notice.style.backgroundColor = '#ffca28';
        notice.style.color = '#333';
        notice.style.padding = '8px 15px';
        notice.style.textAlign = 'center';
        notice.style.fontWeight = 'bold';
        notice.style.position = 'fixed';
        notice.style.top = '0';
        notice.style.left = '0';
        notice.style.width = '100%';
        notice.style.zIndex = '9999999';
        notice.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        notice.innerHTML = '⚠️ 現在メンテナンス期間中ですが、特権ユーザー（バイパス設定）としてアクセスしています。';
        document.body.appendChild(notice);
    }

    function showMaintenanceOverlay(displayPeriod, htmlMessage, theme) {
        document.body.style.visibility = 'hidden';

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.visibility = 'visible';

        let themeIndex;
        if (theme === 'random') {
            themeIndex = Math.floor(Math.random() * 3);
        } else if (theme === 'white') {
            themeIndex = 0;
        } else if (theme === 'dark') {
            themeIndex = 1;
        } else if (theme === 'gradient') {
            themeIndex = 2;
        } else {
            themeIndex = 0;
        }

        const styleId = 'maintenance-custom-styles';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
        }

        let mainTitle = '';
        let themeCss = '';
        let iconSvg = '';

        if (themeIndex === 0) {
            mainTitle = 'System Maintenance';
            overlay.style.backgroundColor = '#f4f7f6';
            themeCss = `
                @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .m-container { background: #ffffff; padding: 60px 80px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.05); text-align: center; max-width: 500px; width: 90%; border: 1px solid #eef1f1; animation: fadeIn 0.8s ease-out forwards; color: #333; font-family: "Helvetica Neue", Arial, sans-serif; }
                .m-icon { width: 70px; height: 70px; margin: 0 auto 25px auto; animation: spin 8s linear infinite; background-size: cover; }
                .m-title { font-size: 24px; font-weight: 600; margin-bottom: 15px; color: #2c3e50; }
                .m-msg { font-size: 15px; line-height: 1.6; color: #555; margin-bottom: 30px; }
                .m-time-box { background-color: #f8fbff; border-top: 4px solid #3498db; padding: 15px 20px; border-radius: 4px; margin-bottom: 40px; text-align: center; }
                .m-time-label { font-size: 13px; font-weight: bold; color: #7f8c8d; margin-bottom: 5px; letter-spacing: 1px; }
                .m-time-val { font-size: 16px; font-weight: 600; color: #2c3e50; }
                .m-btn { display: inline-block; background-color: #3498db; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 30px; font-weight: bold; font-size: 15px; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(52,152,219,0.3); }
                .m-btn:hover { background-color: #2980b9; transform: translateY(-2px); box-shadow: 0 6px 20px rgba(52,152,219,0.4); color: white; }
                @media screen and (max-width: 600px) { .m-container { padding: 40px 20px; width: 85%; } .m-btn { width: 80%; box-sizing: border-box; } }
            `;
            iconSvg = "url('data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%233498db\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"%3E%3Ccircle cx=\"12\" cy=\"12\" r=\"3\"%3E%3C/circle%3E%3Cpath d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z\"%3E%3C/path%3E%3C/svg%3E')";
        } else if (themeIndex === 1) {
            mainTitle = 'System Offline';
            overlay.style.background = 'linear-gradient(135deg, #12151f 0%, #080a0f 100%)';
            const scanner = document.createElement('div');
            scanner.style.position = 'absolute';
            scanner.style.top = '0';
            scanner.style.left = '0';
            scanner.style.width = '100%';
            scanner.style.height = '100%';
            scanner.style.background = 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,204,0.02) 2px, rgba(0,255,204,0.02) 4px)';
            scanner.style.zIndex = '1';
            scanner.style.pointerEvents = 'none';
            overlay.appendChild(scanner);
            themeCss = `
                @keyframes slideDown { to { opacity: 1; transform: translateY(0); } }
                @keyframes pulse { 0% { opacity: 0.5; transform: scale(0.95); text-shadow: 0 0 10px rgba(0,255,204,0.2); } 50% { opacity: 1; transform: scale(1); text-shadow: 0 0 20px rgba(0,255,204,0.8); } 100% { opacity: 0.5; transform: scale(0.95); text-shadow: 0 0 10px rgba(0,255,204,0.2); } }
                .m-container { position: relative; z-index: 2; background: rgba(22, 28, 41, 0.7); backdrop-filter: blur(10px); padding: 60px 80px; border-radius: 8px; text-align: center; max-width: 500px; width: 90%; border: 1px solid rgba(0,255,204,0.2); box-shadow: 0 0 40px rgba(0,255,204,0.05), inset 0 0 20px rgba(0,0,0,0.5); opacity: 0; transform: translateY(-30px); animation: slideDown 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards; color: #e5eef5; font-family: "SF Pro Text", -apple-system, sans-serif; }
                .m-icon { width: 60px; height: 60px; margin: 0 auto 25px auto; animation: pulse 2.5s infinite; background-size: cover; }
                .m-title { font-size: 22px; font-weight: 400; letter-spacing: 3px; margin-bottom: 15px; color: #ffffff; text-transform: uppercase; }
                .m-msg { font-size: 15px; line-height: 1.7; color: #8c9bb3; margin-bottom: 35px; }
                .m-time-box { background-color: rgba(0, 255, 204, 0.05); border: 1px solid rgba(0, 255, 204, 0.3); padding: 15px 20px; margin-bottom: 40px; text-align: center; }
                .m-time-label { font-size: 12px; color: #00ffcc; margin-bottom: 8px; letter-spacing: 2px; }
                .m-time-val { font-family: "Courier New", Courier, monospace; font-size: 18px; color: #ffffff; letter-spacing: 1px; text-shadow: 0 0 5px rgba(255,255,255,0.3); }
                .m-btn { display: inline-block; background-color: transparent; color: #00ffcc; text-decoration: none; padding: 12px 35px; border: 1px solid #00ffcc; font-weight: 400; font-size: 14px; letter-spacing: 2px; text-transform: uppercase; transition: all 0.3s ease; }
                .m-btn:hover { background-color: #00ffcc; color: #12151f; box-shadow: 0 0 20px rgba(0,255,204,0.6); }
                @media screen and (max-width: 600px) { .m-container { padding: 40px 20px; width: 85%; } .m-btn { width: 85%; box-sizing: border-box; } }
            `;
            iconSvg = "url('data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%2300ffcc\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"%3E%3Crect x=\"2\" y=\"2\" width=\"20\" height=\"8\" rx=\"2\" ry=\"2\"%3E%3C/rect%3E%3Crect x=\"2\" y=\"14\" width=\"20\" height=\"8\" rx=\"2\" ry=\"2\"%3E%3C/rect%3E%3Cline x1=\"6\" y1=\"6\" x2=\"6.01\" y2=\"6\"%3E%3C/line%3E%3Cline x1=\"6\" y1=\"18\" x2=\"6.01\" y2=\"18\"%3E%3C/line%3E%3C/svg%3E')";
        } else {
            mainTitle = 'Wait a Moment...';
            overlay.style.background = 'linear-gradient(-45deg, #f3e7e9, #e3eeff, #e9defa, #fdfbfb)';
            overlay.style.backgroundSize = '400% 400%';
            overlay.style.animation = 'gradientBG 15s ease infinite';
            themeCss = `
                @keyframes gradientBG { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
                @keyframes floatUp { to { opacity: 1; transform: translateY(0); } }
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                .m-container { background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); padding: 60px 70px; border-radius: 20px; text-align: center; max-width: 500px; width: 90%; box-shadow: 0 15px 35px rgba(0,0,0,0.05), border 1px solid rgba(255,255,255,0.5); opacity: 0; transform: translateY(40px); animation: floatUp 1s ease-out forwards; color: #333; font-family: "Quicksand", "Rounded Mplus 1c", "Hiragino Maru Gothic Pro", sans-serif; }
                .m-icon { width: 80px; height: 80px; margin: 0 auto 20px auto; animation: spin 8s linear infinite; background-size: cover; }
                .m-title { font-size: 26px; font-weight: 700; margin-bottom: 20px; background: -webkit-linear-gradient(45deg, #fbc2eb 0%, #a18cd1 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
                .m-msg { font-size: 15px; line-height: 1.8; color: #666; margin-bottom: 30px; }
                .m-time-box { background-color: rgba(255,255,255,0.6); padding: 18px 20px; border-radius: 12px; margin-bottom: 40px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); }
                .m-time-label { font-size: 13px; font-weight: 600; color: #999; margin-bottom: 8px; }
                .m-time-val { font-size: 16px; font-weight: 700; color: #555; }
                .m-btn { display: inline-block; background: linear-gradient(to right, #a18cd1 0%, #fbc2eb 51%, #a18cd1 100%); background-size: 200% auto; color: white; text-decoration: none; padding: 15px 45px; border-radius: 50px; font-weight: bold; font-size: 16px; transition: 0.5s; box-shadow: 0 5px 15px rgba(161,140,209,0.4); }
                .m-btn:hover { background-position: right center; color: #fff; transform: translateY(-2px); box-shadow: 0 8px 20px rgba(161,140,209,0.6); text-decoration: none; }
                @media screen and (max-width: 600px) { .m-container { padding: 40px 20px; width: 85%; border-radius: 16px; } .m-btn { width: 80%; box-sizing: border-box; } }
            `;
            iconSvg = "url('data:image/svg+xml,%3Csvg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"url(%23g1)\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"%3E%3Cdefs%3E%3ClinearGradient id=\"g1\" x1=\"0%25\" y1=\"0%25\" x2=\"100%25\" y2=\"100%25\"%3E%3Cstop offset=\"0%25\" style=\"stop-color:%23fbc2eb;stop-opacity:1\" /%3E%3Cstop offset=\"100%25\" style=\"stop-color:%23a18cd1;stop-opacity:1\" /%3E%3C/linearGradient%3E%3C/defs%3E%3Ccircle cx=\"12\" cy=\"12\" r=\"3\"%3E%3C/circle%3E%3Cpath d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z\"%3E%3C/path%3E%3C/svg%3E')";
        }

        styleTag.innerHTML = themeCss;

        const container = document.createElement('div');
        container.className = 'm-container';

        const icon = document.createElement('div');
        icon.className = 'm-icon';
        icon.style.backgroundImage = iconSvg;

        const title = document.createElement('div');
        title.className = 'm-title';
        title.innerText = mainTitle;

        const txtBox = document.createElement('div');
        txtBox.className = 'm-msg';
        txtBox.innerHTML = htmlMessage;

        const timeBox = document.createElement('div');
        timeBox.className = 'm-time-box';
        timeBox.innerHTML = '<div class="m-time-label">メンテナンス予定時間</div><div class="m-time-val">' + displayPeriod + '</div>';

        const btn = document.createElement('a');
        btn.href = '/k/';
        btn.className = 'm-btn';
        btn.innerText = 'ポータル画面へ戻る';

        container.appendChild(icon);
        container.appendChild(title);
        container.appendChild(txtBox);
        container.appendChild(timeBox);
        container.appendChild(btn);

        overlay.appendChild(container);
        document.documentElement.appendChild(overlay);
    }

})(kintone.$PLUGIN_ID);

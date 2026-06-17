/* 電子鎖保固登錄表單：前端驗證 + AJAX 送出 */
(function () {
	'use strict';

	var form = document.getElementById('lwForm');
	if (!form || typeof lockWarrantyCfg === 'undefined') {
		return;
	}

	var submitBtn = document.getElementById('lwSubmit');
	var msgBox = document.getElementById('lwMsg');
	var snPattern = new RegExp(lockWarrantyCfg.snPattern);

	// 序號自動轉大寫、去空白
	var snInput = document.getElementById('lwSn');
	snInput.addEventListener('input', function () {
		this.value = this.value.toUpperCase().replace(/\s/g, '');
	});

	function setInvalid(input, isInvalid) {
		input.classList.toggle('lw-invalid', isInvalid);
	}

	function validate() {
		var errors = [];

		var sn = snInput.value.trim();
		var snOk = snPattern.test(sn);
		setInvalid(snInput, !snOk);
		if (!snOk) {
			errors.push('序號格式不正確，請核對保固卡上的序號。');
		}

		var phoneInput = document.getElementById('lwPhone');
		var phoneOk = /^09\d{8}$/.test(phoneInput.value.trim());
		setInvalid(phoneInput, !phoneOk);
		if (!phoneOk) {
			errors.push('請輸入有效的手機號碼（09 開頭共 10 碼）。');
		}

		// 其餘必填交給瀏覽器原生驗證
		if (!form.checkValidity()) {
			errors.push('請完整填寫所有必填欄位並勾選同意條款。');
		}

		return errors;
	}

	form.addEventListener('submit', function (event) {
		event.preventDefault();
		msgBox.textContent = '';

		var errors = validate();
		if (errors.length) {
			msgBox.textContent = errors.join('\n');
			return;
		}

		submitBtn.disabled = true;
		submitBtn.textContent = '送出中…';

		var data = new FormData(form);
		data.append('action', 'lock_warranty_submit');
		data.append('nonce', lockWarrantyCfg.nonce);

		fetch(lockWarrantyCfg.ajaxUrl, { method: 'POST', body: data })
			.then(function (response) { return response.json(); })
			.then(function (result) {
				if (result.success) {
					form.hidden = true;
					document.querySelector('.lw-head .lw-subtitle').textContent = '感謝您的登錄';
					document.getElementById('lwSuccessNo').textContent = result.data.warrantyNo;
					document.getElementById('lwSuccessExpiry').textContent = result.data.expiry;
					document.getElementById('lwSuccess').hidden = false;
				} else {
					msgBox.textContent = (result.data && result.data.message) || '送出失敗，請稍後再試。';
				}
			})
			.catch(function () {
				msgBox.textContent = '網路連線異常，請稍後再試。';
			})
			.finally(function () {
				submitBtn.disabled = false;
				submitBtn.textContent = '送出保固登錄';
			});
	});
})();

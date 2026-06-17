<?php
/**
 * Plugin Name: 電子鎖保固登錄
 * Description: 電子鎖保固登錄系統：前端登錄表單（短代碼 [lock_warranty_form]）、後台保固紀錄管理、保固查詢 REST API。
 * Version:     1.0.0
 * Author:      你的公司名稱
 * Text Domain: lock-warranty
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* =========================================================
 * CONFIG — 所有可調整的設定集中在此
 * ========================================================= */
const LOCK_WARRANTY_CONFIG = array(
	// 序號格式：2 碼英文 + 8~12 碼英數（佔位規則，依實際序號修改）
	'SN_PATTERN'      => '/^[A-Z]{2}[A-Z0-9]{8,12}$/',
	// 保固月數（自購買日起算）
	'WARRANTY_MONTHS' => 24,
	// 登錄通知信箱（留空 = 用網站管理員信箱）
	'NOTIFY_EMAIL'    => '',
	// 產品型號清單（範例，依實際產品線修改）
	'MODELS'          => array( 'DL-100 指紋電子鎖', 'DL-200 指紋密碼鎖', 'DL-300 人臉辨識鎖', 'DL-500 全自動智慧鎖' ),
	// 購買通路選項
	'CHANNELS'        => array( '官方網站', '經銷商門市', 'MOMO', 'PChome', '蝦皮', '其他' ),
	// 購買日最早可回溯天數（避免亂填過久以前的日期）
	'MAX_BACKDATE_DAYS' => 365,
);

/* =========================================================
 * 自訂文章類型：保固紀錄
 * ========================================================= */
function lock_warranty_register_cpt() {
	register_post_type( 'warranty_record', array(
		'labels' => array(
			'name'          => '保固登錄',
			'singular_name' => '保固紀錄',
			'edit_item'     => '檢視保固紀錄',
			'search_items'  => '搜尋保固紀錄',
		),
		'public'              => false,
		'show_ui'             => true,
		'show_in_menu'        => true,
		'menu_icon'           => 'dashicons-shield',
		'capability_type'     => 'post',
		'capabilities'        => array( 'create_posts' => 'do_not_allow' ), // 只能由前端表單建立
		'map_meta_cap'        => true,
		'supports'            => array( 'title' ),
		'exclude_from_search' => true,
	) );
}
add_action( 'init', 'lock_warranty_register_cpt' );

/* =========================================================
 * 前端：短代碼 [lock_warranty_form]
 * ========================================================= */
function lock_warranty_form_shortcode() {
	$config = LOCK_WARRANTY_CONFIG;

	wp_enqueue_style( 'lock-warranty-form', plugins_url( 'assets/form.css', __FILE__ ), array(), '1.0.0' );
	wp_enqueue_script( 'lock-warranty-form', plugins_url( 'assets/form.js', __FILE__ ), array(), '1.0.0', true );
	wp_localize_script( 'lock-warranty-form', 'lockWarrantyCfg', array(
		'ajaxUrl'   => admin_url( 'admin-ajax.php' ),
		'nonce'     => wp_create_nonce( 'lock_warranty_submit' ),
		'snPattern' => trim( $config['SN_PATTERN'], '/' ),
	) );

	// 支援 URL 參數預填（出貨通知信可夾帶 ?sn=xxx&model=xxx）
	$prefillSn    = isset( $_GET['sn'] ) ? sanitize_text_field( wp_unslash( $_GET['sn'] ) ) : '';
	$prefillModel = isset( $_GET['model'] ) ? sanitize_text_field( wp_unslash( $_GET['model'] ) ) : '';

	ob_start();
	?>
	<div class="lw-wrap">
		<div class="lw-card">
			<div class="lw-head">
				<span class="lw-head-icon" aria-hidden="true">&#128274;</span>
				<h2 class="lw-title">產品保固登錄</h2>
				<p class="lw-subtitle">完成登錄即啟用 <?php echo intval( $config['WARRANTY_MONTHS'] / 12 ); ?> 年原廠保固，並享有到府維修服務</p>
			</div>

			<form id="lwForm" class="lw-form" novalidate>
				<fieldset class="lw-fieldset">
					<legend class="lw-legend">產品資訊</legend>

					<div class="lw-field">
						<label class="lw-label" for="lwModel">產品型號 <span class="lw-required">*</span></label>
						<select class="lw-input" id="lwModel" name="model" required>
							<option value="">請選擇型號</option>
							<?php foreach ( $config['MODELS'] as $model ) : ?>
								<option value="<?php echo esc_attr( $model ); ?>" <?php selected( $prefillModel, $model ); ?>><?php echo esc_html( $model ); ?></option>
							<?php endforeach; ?>
						</select>
					</div>

					<div class="lw-field">
						<label class="lw-label" for="lwSn">產品序號 <span class="lw-required">*</span></label>
						<input class="lw-input" type="text" id="lwSn" name="sn" required
							placeholder="例：DL20250001234" autocomplete="off"
							value="<?php echo esc_attr( $prefillSn ); ?>">
						<p class="lw-hint">序號位於保固卡及產品包裝盒側面貼紙</p>
					</div>

					<div class="lw-row">
						<div class="lw-field">
							<label class="lw-label" for="lwPurchaseDate">購買日期 <span class="lw-required">*</span></label>
							<input class="lw-input" type="date" id="lwPurchaseDate" name="purchaseDate" required
								max="<?php echo esc_attr( wp_date( 'Y-m-d' ) ); ?>">
						</div>
						<div class="lw-field">
							<label class="lw-label" for="lwChannel">購買通路 <span class="lw-required">*</span></label>
							<select class="lw-input" id="lwChannel" name="channel" required>
								<option value="">請選擇</option>
								<?php foreach ( $config['CHANNELS'] as $channel ) : ?>
									<option value="<?php echo esc_attr( $channel ); ?>"><?php echo esc_html( $channel ); ?></option>
								<?php endforeach; ?>
							</select>
						</div>
					</div>

					<div class="lw-field">
						<label class="lw-label" for="lwInvoice">發票號碼／訂單編號</label>
						<input class="lw-input" type="text" id="lwInvoice" name="invoice" placeholder="例：AB-12345678（選填）">
					</div>
				</fieldset>

				<fieldset class="lw-fieldset">
					<legend class="lw-legend">聯絡資訊</legend>

					<div class="lw-row">
						<div class="lw-field">
							<label class="lw-label" for="lwName">姓名 <span class="lw-required">*</span></label>
							<input class="lw-input" type="text" id="lwName" name="name" required autocomplete="name">
						</div>
						<div class="lw-field">
							<label class="lw-label" for="lwPhone">手機號碼 <span class="lw-required">*</span></label>
							<input class="lw-input" type="tel" id="lwPhone" name="phone" required
								placeholder="0912345678" autocomplete="tel">
						</div>
					</div>

					<div class="lw-field">
						<label class="lw-label" for="lwEmail">電子信箱 <span class="lw-required">*</span></label>
						<input class="lw-input" type="email" id="lwEmail" name="email" required autocomplete="email">
						<p class="lw-hint">保固憑證將寄送至此信箱，請務必填寫正確</p>
					</div>

					<div class="lw-field">
						<label class="lw-label" for="lwAddress">安裝地址</label>
						<input class="lw-input" type="text" id="lwAddress" name="address" placeholder="到府維修服務使用（選填）">
					</div>
				</fieldset>

				<?php /* honeypot：機器人會填，真人看不到 */ ?>
				<div class="lw-hp" aria-hidden="true">
					<label for="lwWebsite">Website</label>
					<input type="text" id="lwWebsite" name="website" tabindex="-1" autocomplete="off">
				</div>

				<label class="lw-consent">
					<input type="checkbox" id="lwConsent" name="consent" required>
					<span>我同意貴公司依<a href="/privacy/" target="_blank" rel="noopener">隱私權政策</a>蒐集、處理及利用上述個人資料，作為保固服務與產品通知用途。</span>
				</label>

				<button type="submit" class="lw-submit" id="lwSubmit">送出保固登錄</button>
				<div class="lw-msg" id="lwMsg" role="alert"></div>
			</form>

			<div class="lw-success" id="lwSuccess" hidden>
				<div class="lw-success-icon" aria-hidden="true">&#10004;</div>
				<h3>保固登錄完成！</h3>
				<p>您的保固編號：<strong id="lwSuccessNo"></strong></p>
				<p>保固到期日：<strong id="lwSuccessExpiry"></strong></p>
				<p class="lw-hint">保固憑證已寄送至您的信箱，請妥善保留。</p>
			</div>
		</div>
	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'lock_warranty_form', 'lock_warranty_form_shortcode' );

/* =========================================================
 * AJAX：接收登錄表單
 * ========================================================= */
function lock_warranty_handle_submit() {
	$config = LOCK_WARRANTY_CONFIG;

	if ( ! check_ajax_referer( 'lock_warranty_submit', 'nonce', false ) ) {
		wp_send_json_error( array( 'message' => '頁面已過期，請重新整理後再試。' ), 403 );
	}

	// honeypot 有值 = 機器人，回成功假象但不寫入
	if ( ! empty( $_POST['website'] ) ) {
		wp_send_json_success( array( 'warrantyNo' => 'W-000000', 'expiry' => '' ) );
	}

	$sn           = strtoupper( sanitize_text_field( wp_unslash( $_POST['sn'] ?? '' ) ) );
	$model        = sanitize_text_field( wp_unslash( $_POST['model'] ?? '' ) );
	$purchaseDate = sanitize_text_field( wp_unslash( $_POST['purchaseDate'] ?? '' ) );
	$channel      = sanitize_text_field( wp_unslash( $_POST['channel'] ?? '' ) );
	$invoice      = sanitize_text_field( wp_unslash( $_POST['invoice'] ?? '' ) );
	$name         = sanitize_text_field( wp_unslash( $_POST['name'] ?? '' ) );
	$phone        = sanitize_text_field( wp_unslash( $_POST['phone'] ?? '' ) );
	$email        = sanitize_email( wp_unslash( $_POST['email'] ?? '' ) );
	$address      = sanitize_text_field( wp_unslash( $_POST['address'] ?? '' ) );

	// --- 驗證 ---
	$errors = array();

	if ( ! in_array( $model, $config['MODELS'], true ) ) {
		$errors[] = '請選擇有效的產品型號。';
	}
	if ( ! preg_match( $config['SN_PATTERN'], $sn ) ) {
		$errors[] = '序號格式不正確，請核對保固卡上的序號。';
	}
	if ( ! preg_match( '/^09\d{8}$/', $phone ) ) {
		$errors[] = '請輸入有效的台灣手機號碼（09 開頭共 10 碼）。';
	}
	if ( empty( $email ) || ! is_email( $email ) ) {
		$errors[] = '請輸入有效的電子信箱。';
	}
	if ( mb_strlen( $name ) < 2 ) {
		$errors[] = '請輸入姓名。';
	}
	if ( ! in_array( $channel, $config['CHANNELS'], true ) ) {
		$errors[] = '請選擇購買通路。';
	}

	$purchaseTs = strtotime( $purchaseDate );
	$today      = strtotime( wp_date( 'Y-m-d' ) );
	if ( ! $purchaseTs || $purchaseTs > $today || $purchaseTs < $today - $config['MAX_BACKDATE_DAYS'] * DAY_IN_SECONDS ) {
		$errors[] = '購買日期無效（不可為未來日期，且不可超過購買後 ' . $config['MAX_BACKDATE_DAYS'] . ' 天登錄）。';
	}

	// 擴充點：之後可掛 filter 改成查序號白名單或打 ERP API 驗證
	$errors = apply_filters( 'lock_warranty_validate_sn', $errors, $sn, $model );

	if ( $errors ) {
		wp_send_json_error( array( 'message' => implode( "\n", $errors ) ), 400 );
	}

	// 同序號擋重複登錄
	$existing = get_posts( array(
		'post_type'      => 'warranty_record',
		'post_status'    => 'publish',
		'meta_key'       => '_lw_sn',
		'meta_value'     => $sn,
		'posts_per_page' => 1,
		'fields'         => 'ids',
	) );
	if ( $existing ) {
		wp_send_json_error( array( 'message' => '此序號已完成保固登錄。如有疑問請聯繫客服。' ), 409 );
	}

	// --- 寫入紀錄 ---
	$expiryTs = strtotime( '+' . $config['WARRANTY_MONTHS'] . ' months', $purchaseTs );
	$expiry   = wp_date( 'Y-m-d', $expiryTs );

	$postId = wp_insert_post( array(
		'post_type'   => 'warranty_record',
		'post_status' => 'publish',
		'post_title'  => $sn . '｜' . $name,
	), true );

	if ( is_wp_error( $postId ) ) {
		wp_send_json_error( array( 'message' => '系統忙碌中，請稍後再試。' ), 500 );
	}

	$warrantyNo = 'W-' . str_pad( (string) $postId, 6, '0', STR_PAD_LEFT );

	$meta = array(
		'_lw_warranty_no'   => $warrantyNo,
		'_lw_sn'            => $sn,
		'_lw_model'         => $model,
		'_lw_purchase_date' => $purchaseDate,
		'_lw_channel'       => $channel,
		'_lw_invoice'       => $invoice,
		'_lw_name'          => $name,
		'_lw_phone'         => $phone,
		'_lw_email'         => $email,
		'_lw_address'       => $address,
		'_lw_expiry'        => $expiry,
	);
	foreach ( $meta as $key => $value ) {
		update_post_meta( $postId, $key, $value );
	}

	// --- 通知信 ---
	$notifyEmail = $config['NOTIFY_EMAIL'] ? $config['NOTIFY_EMAIL'] : get_option( 'admin_email' );
	$siteName    = wp_specialchars_decode( get_bloginfo( 'name' ), ENT_QUOTES );

	// 給客戶的保固憑證
	wp_mail(
		$email,
		'【' . $siteName . '】保固登錄完成通知（' . $warrantyNo . '）',
		"親愛的 {$name} 您好：\n\n您的產品保固登錄已完成，以下為保固憑證資訊，請妥善保留本信件。\n\n"
		. "保固編號：{$warrantyNo}\n產品型號：{$model}\n產品序號：{$sn}\n購買日期：{$purchaseDate}\n保固到期日：{$expiry}\n\n"
		. "如需維修服務，請來信或來電並提供保固編號。\n\n{$siteName} 敬上"
	);

	// 給客服的內部通知
	wp_mail(
		$notifyEmail,
		'【保固登錄】新登錄：' . $sn . '（' . $model . '）',
		"保固編號：{$warrantyNo}\n序號：{$sn}\n型號：{$model}\n姓名：{$name}\n電話：{$phone}\nEmail：{$email}\n購買日期：{$purchaseDate}\n通路：{$channel}\n後台檢視：" . admin_url( 'post.php?post=' . $postId . '&action=edit' )
	);

	// 擴充點：LINE Notify、簡訊等通知掛這個 hook
	do_action( 'lock_warranty_registered', $postId, $meta );

	wp_send_json_success( array(
		'warrantyNo' => $warrantyNo,
		'expiry'     => $expiry,
	) );
}
add_action( 'wp_ajax_lock_warranty_submit', 'lock_warranty_handle_submit' );
add_action( 'wp_ajax_nopriv_lock_warranty_submit', 'lock_warranty_handle_submit' );

/* =========================================================
 * REST API（之後串接 ERP / 客服系統用）
 * ========================================================= */
function lock_warranty_register_rest_routes() {
	// 公開：依序號查保固狀態（只回傳狀態，不洩漏個資）
	register_rest_route( 'lock-warranty/v1', '/check', array(
		'methods'             => 'GET',
		'permission_callback' => '__return_true',
		'args'                => array(
			'sn' => array( 'required' => true, 'sanitize_callback' => 'sanitize_text_field' ),
		),
		'callback'            => function ( WP_REST_Request $request ) {
			$sn    = strtoupper( $request->get_param( 'sn' ) );
			$posts = get_posts( array(
				'post_type'      => 'warranty_record',
				'post_status'    => 'publish',
				'meta_key'       => '_lw_sn',
				'meta_value'     => $sn,
				'posts_per_page' => 1,
				'fields'         => 'ids',
			) );
			if ( ! $posts ) {
				return new WP_REST_Response( array( 'registered' => false ), 200 );
			}
			$postId = $posts[0];
			$expiry = get_post_meta( $postId, '_lw_expiry', true );
			return new WP_REST_Response( array(
				'registered' => true,
				'model'      => get_post_meta( $postId, '_lw_model', true ),
				'expiry'     => $expiry,
				'inWarranty' => strtotime( $expiry ) >= strtotime( wp_date( 'Y-m-d' ) ),
			), 200 );
		},
	) );

	// 內部：拉登錄紀錄清單（需管理員權限，搭配 WP 應用程式密碼供 ERP 使用）
	register_rest_route( 'lock-warranty/v1', '/records', array(
		'methods'             => 'GET',
		'permission_callback' => function () {
			return current_user_can( 'manage_options' );
		},
		'args'                => array(
			'page'     => array( 'default' => 1, 'sanitize_callback' => 'absint' ),
			'per_page' => array( 'default' => 50, 'sanitize_callback' => 'absint' ),
		),
		'callback'            => function ( WP_REST_Request $request ) {
			$query = new WP_Query( array(
				'post_type'      => 'warranty_record',
				'post_status'    => 'publish',
				'paged'          => $request->get_param( 'page' ),
				'posts_per_page' => min( 100, $request->get_param( 'per_page' ) ),
				'orderby'        => 'date',
				'order'          => 'DESC',
			) );
			$records = array();
			foreach ( $query->posts as $post ) {
				$records[] = array(
					'warrantyNo'   => get_post_meta( $post->ID, '_lw_warranty_no', true ),
					'sn'           => get_post_meta( $post->ID, '_lw_sn', true ),
					'model'        => get_post_meta( $post->ID, '_lw_model', true ),
					'name'         => get_post_meta( $post->ID, '_lw_name', true ),
					'phone'        => get_post_meta( $post->ID, '_lw_phone', true ),
					'email'        => get_post_meta( $post->ID, '_lw_email', true ),
					'purchaseDate' => get_post_meta( $post->ID, '_lw_purchase_date', true ),
					'channel'      => get_post_meta( $post->ID, '_lw_channel', true ),
					'expiry'       => get_post_meta( $post->ID, '_lw_expiry', true ),
					'registeredAt' => $post->post_date,
				);
			}
			return new WP_REST_Response( array(
				'total'   => (int) $query->found_posts,
				'pages'   => (int) $query->max_num_pages,
				'records' => $records,
			), 200 );
		},
	) );
}
add_action( 'rest_api_init', 'lock_warranty_register_rest_routes' );

/* =========================================================
 * 後台：列表欄位 + 序號搜尋
 * ========================================================= */
function lock_warranty_admin_columns( $columns ) {
	return array(
		'cb'             => $columns['cb'],
		'title'          => '序號｜姓名',
		'lw_model'       => '型號',
		'lw_phone'       => '電話',
		'lw_purchase'    => '購買日',
		'lw_expiry'      => '保固到期',
		'date'           => '登錄時間',
	);
}
add_filter( 'manage_warranty_record_posts_columns', 'lock_warranty_admin_columns' );

function lock_warranty_admin_column_content( $column, $postId ) {
	switch ( $column ) {
		case 'lw_model':
			echo esc_html( get_post_meta( $postId, '_lw_model', true ) );
			break;
		case 'lw_phone':
			echo esc_html( get_post_meta( $postId, '_lw_phone', true ) );
			break;
		case 'lw_purchase':
			echo esc_html( get_post_meta( $postId, '_lw_purchase_date', true ) );
			break;
		case 'lw_expiry':
			$expiry = get_post_meta( $postId, '_lw_expiry', true );
			$inWarranty = $expiry && strtotime( $expiry ) >= strtotime( wp_date( 'Y-m-d' ) );
			printf(
				'<span style="color:%s;font-weight:600;">%s%s</span>',
				$inWarranty ? '#1a7f37' : '#c0392b',
				esc_html( $expiry ),
				$inWarranty ? '' : '（已過保）'
			);
			break;
	}
}
add_action( 'manage_warranty_record_posts_custom_column', 'lock_warranty_admin_column_content', 10, 2 );

// 後台搜尋框可直接搜序號 / 電話 / Email（meta 搜尋）
function lock_warranty_admin_search( $query ) {
	if ( ! is_admin() || ! $query->is_main_query() || $query->get( 'post_type' ) !== 'warranty_record' ) {
		return;
	}
	$keyword = $query->get( 's' );
	if ( ! $keyword ) {
		return;
	}
	$query->set( 's', '' );
	$query->set( 'meta_query', array(
		'relation' => 'OR',
		array( 'key' => '_lw_sn', 'value' => $keyword, 'compare' => 'LIKE' ),
		array( 'key' => '_lw_phone', 'value' => $keyword, 'compare' => 'LIKE' ),
		array( 'key' => '_lw_email', 'value' => $keyword, 'compare' => 'LIKE' ),
		array( 'key' => '_lw_name', 'value' => $keyword, 'compare' => 'LIKE' ),
	) );
}
add_action( 'pre_get_posts', 'lock_warranty_admin_search' );

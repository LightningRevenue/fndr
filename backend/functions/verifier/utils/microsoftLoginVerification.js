const UserAgent = require('user-agents');
const { axiosPost } = require('../../utils/axios');
const winston = require('winston');
const { loggerTypes } = require('../../logging/logger');
const sqlAsync = require('../../../database/sqlAsync');

const userAgent = new UserAgent({ platform: 'Win32' }); // windows user agents only

const logger = winston.loggers.get(loggerTypes.msLogin);

const url = `https://login.microsoftonline.com/common/GetCredentialType?mkt=en-US`,
	originalRequest =
		'rQQIARAAhZK_j9t0AMXj5C69iwo9tRUqA-gGhgpw8vXXP3OiqHEcX37YziVxcmczWPGPOE78K_5xif0XMFZCVKILUpGQuAUEAycmQGK56eYbuyAqISGmDh046FyxPL2n97b3qexQVRxUsSp4vwSr4OA9gqZIgiB1FIcGhRJ1HaAMblEoZtbx6wrSlDGNblf2Pn7n_Nc0-qP31edPb_7-wfY3Z8j-PEnC-KBWW6_X1WA2cwyragRezZ36puPbp_AcQS4R5Elx2_LR8eisGFM4g1MMjQOcIQkKQpqpit5grUB-qXqdRPE6megAoMj2WjjmPYlrJapsZIpsQEUeAyVnlyq3JFWO9VTOTqRFC5Oy631uE4Js49LCSCRu6IqLAaYeDnJRtvOr4q1-I03m8F8JIie3_i7uzoLI08IgTp6UHhcnusqOyBGHzfpoTFEQnJBs57Dp1AWbzIWMYVMHDYKNO0hja0TAVTs3GpQZ-fOpbc7HdkyzKkEoDmquUhGLaYDNTLYl4BKwjRXP1PvjpbZo-yI-CEMiwzd8PResOdE5HBwtOY0V6M1YVNMONu5xIB_nmxVArWPQhUQTa4bL0M3Rpp6ZljXKevhQZ1G-7w2lIwvMBBDNqWbM5lrf0egVSPNpE6Cyi2tcHZ1mpMyfDo-t2UrHHDhJElnPR2ZnwdpCLE_EPNO62nTYQ-dSHuNZo88I3Q2PpYSVmhHJtu2z0tuvufcUfl8qXxsv8C9KdBBavmPuh1Ewc1zrdUicwlr_v9QOPKvacN3LLeT51ls75b137yH7hft3QelgZ6eyV7hX2C-82EKebl8T9_Lht-c_XH708IurT3579tn94sV2DYMm7fOsAzEArB4_9JVkpHOrKMHF-cSXDpVBS8T9OmQG4wfUAfaojDwqly_Kux1Ok1oypYG_ysinNwo_7f4vu1c371QqqaO5gTF1rfj2K4Z_fqPw4s2LX358_PWXL_9sP7_14eBEF7Ga28UdvuunDptP_GXLcyLeh7ETZqOj5MRtuPVwKDIPvtsr_AM1',
	flowToken =
		'AQABAAEAAAAmoFfGtYxvRrNriQdPKIZ-f01dLKPT7ciDl7fHtIwI1dwUEuoMx3vompke-nv3ETUnpOOP3UK5gfZXFu4qyqJ-F_mfmOD-PAqhy1jOQbE8zkIT9SPdedY6uwuDCA1JmmggUP7BorvjnXD3tsEwdHP_Dlf7bF8OQAH4_O-XMPkJzWMsGPCZNBTNYyKo19hkTRooWfhKXB9Sd3DZ_QQQXORxQG44cxABbaGyIsQENnDYy2hUqnH3EzjnnhFn3YzSZOeQW5-1xnd9SfR-_1dvYAPkNaNssydmSztJtxF_QaqmLcoZFtCSyhdW-aqUlO77QzJUzY_Vp0SPWKXSnTaYU9t1HWhNZ3b-CQ75ABybmw-Ey0hK3uDuedJPUNFNSS3_xMnbbxG53W9bkW71febnFD0kAnxPJ4KYiQJu82_TDPy1U9XWnmbkz7DSclGqJbA061XMe5FhuzeMPJDegleFqyADAM0kLRcW1606bt5E84px3t57h6bcszUvrH_nOkNL8YPnUSWVsmtEtRxOTJkQ8cW0pBbxT9OrODUcoaTIlWxdnU3N07F8JGiDmtTEk9HshbLPDaIWkpwiYSfcYc2gkqtNeeYxpYemme7nMQDrZHI3Z1mWe0MMjl9GHhgslfqbPcuuVm5Dmrf-uHpVbuxTKOYiIAA';

// init cache table once at module load
(async () => {
	try {
		await sqlAsync.runAsync(`CREATE TABLE IF NOT EXISTS ms_login_cache (
            email TEXT PRIMARY KEY,
            valid INTEGER NOT NULL,
            checked_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )`);
	} catch (_) { /* table may already exist */ }
})();

const cookie =
	'x-ms-gateway-slice=estsfd; stsservicecookie=estsfd; AADSSO=NA|NoExtension; buid=0.AQ8AMe_N-B6jSkuT5F9XHpElWltEZUfGMrBJg-Ydk3ZSdsoBAAA.AQABAAEAAAAmoFfGtYxvRrNriQdPKIZ-OZy6yN71271H4KvY5Pwa5zdMbeqpcyKVMutaU6hmtuWFefy8xErqOPU05qIMLfl7wPAD6cZ_t4Bn0g14p8Emm58wWL6khP45sCNKGzawxAYgAA; esctx=PAQABAAEAAAAmoFfGtYxvRrNriQdPKIZ-68uuSujSl1FOTm0KCWRcYUusWlBUohl-w_pVLZQnQTHFiNzTOYy9AOdmD5xAC2pPhuL3K3dCzxMfeetN5ff8WnRc7C2aWwQJ7iCCfr8shc3LujEUYaIxmE1vxk4i9QIfEy5vxVslIOWYUSpkmU1TtxZl5hLkQB9bJUgBuRwbmtggAA; esctx-WZRey7ZaEq4=AQABAAEAAAAmoFfGtYxvRrNriQdPKIZ-4xLVUtmq3UaaO2Qfyjvw08gz3dCpfGkprq6fclN5YrHpOrkTVmZfWEgADHw45O6_UBHgMA1WC7462t8D_5Oa_2iM5J-aCzb5BU70Tlc6Em9po2zDdEoQUP9LwJaUnGXvtBdhMPifZETb29I6xD6cdSAA; fpc=ArWgrM1pj1RNhX-wRpvotOo; brcap=0';

/**
 * Performs a login verification with API or by looking up on a database
 * @param {string} email
 * @returns
 */
async function microsoftLoginVerification(email) {
	/** @type {{valid: boolean}} */
	let result = {
		valid: false,
	};
	try {
		// check if the email is valid from the database
		const now = Date.now();
		const cached = await sqlAsync.getAsync(
			`SELECT valid FROM ms_login_cache WHERE email = ? AND expires_at > ?`,
			[email, now]
		);
		if (cached) {
			result.valid = !!(/** @type {any} */ (cached).valid);
			return result;
		}

		// create payload
		const payload = {
			username: email,
			isOtherIdpSupported: true,
			checkPhones: false,
			isRemoteNGCSupported: true,
			isCookieBannerShown: false,
			isFidoSupported: true,
			originalRequest: originalRequest,
			// country: "IN", // removing this. works fine without
			forceotclogin: false,
			isExternalFederationDisallowed: false,
			isRemoteConnectSupported: false,
			federationFlags: 0,
			isSignup: false,
			flowToken: flowToken,
			isAccessPassSupported: true,
		};

		// create options
		const options = {
			headers: {
				'User-Agent': userAgent.toString(),
				'Accept-Language': 'en-US,en;q=0.9',
				Cookie: cookie,
				Origin: 'https://login.microsoftonline.com',
				Referer:
					'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=4765445b-32c6-49b0-83e6-1d93765276ca&redirect_uri=https%3A%2F%2Fwww.office.com%2Flandingv2&response_type=code%20id_token&scope=openid%20profile%20https%3A%2F%2Fwww.office.com%2Fv2%2FOfficeHome.All&response_mode=form_post&nonce=638368730385462278.MmQwY2FkZmItYmIyMi00YTgwLWFmNDEtZTcyYTc2YTU0YzBkZDk5ZDBmZDgtNjE1Ny00Yzg4LTg3NjctNDRlMjQ1ZGQzMTgz&ui_locales=en-US&mkt=en-US&client-request-id=c2b81d3e-7275-4be9-a395-a20ce72b05a9&state=VbZBS5SD1fO-s6620X5BIGCi9Lg5zLy8Bui-ooxlQuseS42qHzcA6drnhagdhUgs7BZ44Yi-dquM1s701fdBEL3N0gcqF89OUk_jHnM3Qpp4y3xF9zLeh4IGQPkD_BL7xUMZuI1UKD0zUzxq0-eW0J24C1Cpkplz-CbydeeSyK3RbB-FOmRNPe0fL0rh6CsBz_Oi_7q0uzaC0-Tl3_D9-ay5TFvRWefqb1i2VttTbzSdIjBgLsTVMzy_J_aRK-hNzs3yAO8LJxF1u4eudr5BHg&x-client-SKU=ID_NET6_0&x-client-ver=6.30.1.0&sso_reload=true',
				'Sec-Fetch-Dest': 'empty',
				'Sec-Fetch-Mode': 'cors',
				'Sec-Fetch-Site': 'same-origin',
				'X-KL-Ajax-Request': 'Ajax_Request',
				canary: 'PAQABAAEAAAAmoFfGtYxvRrNriQdPKIZ-qa56txqHwqffKKYylkmhIOyh-3w9R1agwvjUoG_w6qyqs90mYSgASM4uQkxEBqXnGZiJVIojGpEZ28-3BwKfkgAWoUmX_YU-2JW-Dxbu3XfkKyuJwdiRoBarTQ589fdZZH5QM9HMGkBdSzSlyYajQ0Tc1wmyWVrqU-xXYEbI1leADxez2AqP_SCw1D0mm0Akff-65Qx2QAzeqBQUKkXJxCAA',
				'client-request-id': 'c2b81d3e-7275-4be9-a395-a20ce72b05a9',
				hpgact: 1800,
				hpgid: 1104,
				hpgrequestid: 'b8af40fc-d0b3-403c-99da-5bc5e2932802',
				// "sec-ch-ua": `"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"`, // commenting this
				// "sec-ch-ua-mobile": "?1",
				// "sec-ch-ua-platform": `"Android"`,
			},
		};

		// send API login request
		const response = await axiosPost(url, payload, options);

		if (response && response.status === 200 && response?.data) {
			result.valid = !!(response?.data?.IfExistsResult == 5);
		} else {
			logger.error(
				`Non 200 status in microsoftLoginVerification() status -> ${
					response?.status
				} object -> ${JSON.stringify(response)}`
			);
		}

		// Save the status of the outlook email in the database
		const saveNow = Date.now();
		const expiresAt = saveNow + 7 * 24 * 60 * 60 * 1000; // 7 days
		await sqlAsync.runAsync(
			`INSERT INTO ms_login_cache (email, valid, checked_at, expires_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (email) DO UPDATE SET
                 valid = excluded.valid,
                 checked_at = excluded.checked_at,
                 expires_at = excluded.expires_at`,
			[email, result.valid ? 1 : 0, saveNow, expiresAt]
		);
	} catch (error) {
		logger.error(`microsoftLoginVerification() error -> ${error?.toString()}`);
	} finally {
		return result;
	}
}

module.exports = microsoftLoginVerification;

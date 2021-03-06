angular.module('cesium.app.controllers', ['cesium.platform', 'cesium.services'])

  .config(function($stateProvider, $urlRouterProvider) {
    'ngInject';

    $stateProvider

      .state('app', {
        url: "/app",
        abstract: true,
        templateUrl: "templates/menu.html",
        controller: 'AppCtrl',
        data: {
          large: false
        }
      })

      .state('app.home', {
        url: "/home?error",
        views: {
          'menuContent': {
            templateUrl: "templates/home/home.html",
            controller: 'HomeCtrl'
          }
        }
      })

      .state('app.lock', {
        cache: false,
        url: "/lock",
        views: {
          'menuContent': {
            templateUrl: "templates/common/view_passcode.html",
            controller: 'PassCodeCtrl'
          }
        }
      })
    ;

    // if none of the above states are matched, use this as the fallback
    $urlRouterProvider.otherwise('/app/home');

  })

  .controller('AppCtrl', AppController)

  .controller('HomeCtrl', HomeController)

  .controller('PluginExtensionPointCtrl', PluginExtensionPointController)



;

/**
 * Useful controller that could be reuse in plugin, using $scope.extensionPoint for condition rendered in templates
 */
function PluginExtensionPointController($scope, PluginService) {
  'ngInject';
  $scope.extensionPoint = PluginService.extensions.points.current.get();
}

/**
 * Abstract controller (inherited by other controllers)
 */
function AppController($scope, $rootScope, $state, $ionicSideMenuDelegate, $q, $timeout,
                       $ionicHistory, $controller, $window, csPlatform, CryptoUtils, csCrypto,
                       UIUtils, BMA, csWallet, Device, Modals, csConfig, csHttp
) {
  'ngInject';

  $scope.walletData  = csWallet.data;
  $scope.search = {};
  $scope.login = csWallet.isLogin();
  $scope.auth = csWallet.isAuth();
  $scope.motion = UIUtils.motion.default;
  $scope.smallscreen = UIUtils.screen.isSmall();

  $scope.showHome = function() {
    $ionicHistory.nextViewOptions({
      historyRoot: true
    });
    return $state.go('app.home')
      .then(UIUtils.loading.hide);
  };

  // removeIf(no-device)
  ////////////////////////////////////////
  // Device only methods
  // (code removed when NO device)
  ////////////////////////////////////////

  $scope.scanQrCodeAndGo = function() {

    if (!Device.barcode.enable) return;

    // Run scan cordova plugin, on device
    return Device.barcode.scan()
      .then(function(data) {
        if (!data) return;

        // Try to parse as an URI
        return BMA.uri.parse(data)
          .then(function(res){
            if (!res || !res.pubkey) throw {message: 'ERROR.SCAN_UNKNOWN_FORMAT'};
            // If pubkey: open the identity
            return $state.go('app.wot_identity', {
              pubkey: res.pubkey,
              node: res.host ? res.host: null}
            );
          })

          // Not an URI: try WIF or EWIF format
          .catch(function(err) {
            console.debug("[app] Scan data is not an URI (get error: " + (err && err.message || err) + "). Trying to decode as a WIF or EWIF format...");

            // Try to read as WIF format
            return csCrypto.keyfile.parseData(data)
              .then(function(keypair) {
                if (!keypair || !keypair.signPk || !keypair.signSk) throw err; // rethrow the first error (e.g. Bad URI)

                var pubkey = CryptoUtils.base58.encode(keypair.signPk);
                console.debug("[app] Detected WIF/EWIF format. Will login to wallet {" + pubkey.substring(0, 8) + "}");

                // Create a new wallet (if default wallet is already used)
                var wallet = !csWallet.isLogin() ? csWallet : csWallet.children.create({store: false});

                // Login using keypair
                return wallet.login({
                    silent: true,
                    forceAuth: true,
                    minData: false,
                    authData: {
                      pubkey: pubkey,
                      keypair: keypair
                    }
                  })
                  .then(function () {

                    // Open transfer all wallet
                    $ionicHistory.nextViewOptions({
                      historyRoot: true
                    });
                    return $state.go('app.new_transfer', {
                      all: true, // transfer all sources
                      wallet: !wallet.isDefault() ? wallet.id : undefined
                    });
                  });
              })
              // Unknown format (nor URI, nor WIF/EWIF)
              .catch(UIUtils.onError('ERROR.SCAN_UNKNOWN_FORMAT'));
          });
      })
      .catch(UIUtils.onError('ERROR.SCAN_FAILED'));
  };

  ////////////////////////////////////////
  // End of device only methods
  ////////////////////////////////////////
  // endRemoveIf(no-device)

  ////////////////////////////////////////
  // Show Help tour
  ////////////////////////////////////////

  $scope.createHelptipScope = function(isTour, helpController) {
    if (!isTour && ($rootScope.tour || !$rootScope.settings.helptip.enable || UIUtils.screen.isSmall())) {
      return; // avoid other helptip to be launched (e.g. csWallet)
    }
    // Create a new scope for the tour controller
    var helptipScope = $scope.$new();
    $controller(helpController||'HelpTipCtrl', { '$scope': helptipScope});
    return helptipScope;
  };

  $scope.startHelpTour = function(helpController, skipClearCache) {
    $rootScope.tour = true; // to avoid other helptip to be launched (e.g. csWallet)

    // Clear cache history
    if (!skipClearCache) {
      $ionicHistory.clearHistory();
      return $ionicHistory.clearCache()
        .then(function() {
          $scope.startHelpTour(helpController, true/*continue*/);
        });
    }

    var helptipScope = $scope.createHelptipScope(true/*is tour*/, helpController);
    return helptipScope.startHelpTour()
      .then(function() {
        helptipScope.$destroy();
        delete $rootScope.tour;
      })
      .catch(function(err){
        delete $rootScope.tour;
      });
  };

  ////////////////////////////////////////
  // Login & wallet
  ////////////////////////////////////////

  $scope.isLogin = function() {
    return $scope.login;
  };

  // Load wallet data (after login)
  $scope.loadWalletData = function(options) {

    console.warn("[app-controller] DEPRECATED  - Please use csWallet.load() instead of $scope.loadWalletData()", new Error());

    options = options || {};
    var wallet = options.wallet || csWallet;
    return wallet.loadData(options)

      .then(function(walletData) {
        // cancel login
        if (!walletData) throw 'CANCELLED';
        return walletData;
      });
  };

  // Login and load wallet
  $scope.loadWallet = function(options) {

    console.warn("[app-controller] DEPRECATED  - Please use csWallet.loginOrLoad() instead of $scope.loadWallet()", new Error());

    // Make sure the platform is ready
    if (!csPlatform.isStarted()) {
      return csPlatform.ready().then(function(){
        return $scope.loadWallet(options);
      });
    }

    options = options || {};

    var wallet = options.wallet || csWallet;

    // If need auth
    if (options.auth && !wallet.isAuth()) {
      return wallet.auth(options)
        .then(function (walletData) {
          if (walletData) return walletData;
          // failed to auth
          throw 'CANCELLED';
        });
    }

    // If need login
    else if (!wallet.isLogin()) {
      return wallet.login(options)
        .then(function (walletData) {
          if (walletData) return walletData;
          // failed to login
          throw 'CANCELLED';
        });
    }

    // Already login or auth
    else if (!wallet.isDataLoaded(options)) {
      return $scope.loadWalletData(options);
    }
    else {
      return $q.when(wallet.data);
    }
  };

  // Login and go to a state (or wallet if not)
  $scope.loginAndGo = function(state, options) {
    $scope.closeProfilePopover();
    options = options || {};
    var wallet = options.wallet || csWallet;
    delete options.wallet;

    state = state || 'app.view_wallet';

    if (!wallet.isLogin()) {

      // Make sure to protect login modal, if HTTPS enable - fix #340
      if (csConfig.httpsMode && $window.location && $window.location.protocol !== 'https:') {
        var href = $window.location.href;
        var hashIndex = href.indexOf('#');
        var rootPath = (hashIndex != -1) ? href.substr(0, hashIndex) : href;
        rootPath = 'https' + rootPath.substr(4);
        href = rootPath + $state.href(state);
        if (csConfig.httpsModeDebug) {
          // Debug mode: just log, then continue
          console.debug('[httpsMode] --- Should redirect to: ' + href);
        }
        else {
          $window.location.href = href;
          return;
        }
      }

      return wallet.login(options)
        .then(function(){
          return $state.go(state, options);
        })
        .then(UIUtils.loading.hide);
    }
    else {
      return $state.go(state, options);
    }
  };

  // Logout
  $scope.logout = function(options) {
    options = options || {};
    var wallet = options.wallet || csWallet;
    if (!options.force && $scope.profilePopover) {
      // Make the popover if really closed, to avoid UI refresh on popover buttons
      return $scope.profilePopover.hide()
        .then(function(){
          options.force = true;
          return $scope.logout(options);
        });
    }
    if (options.askConfirm) {
      return UIUtils.alert.confirm('CONFIRM.LOGOUT')
        .then(function(confirm) {
          if (confirm) {
            options.askConfirm=false;
            return $scope.logout(options);
          }
        });
    }

    UIUtils.loading.show();
    return wallet.logout()
      .then(function() {
        // Close left menu if open
        if ($ionicSideMenuDelegate.isOpenLeft()) {
          $ionicSideMenuDelegate.toggleLeft();
        }

        // If default wallet: clear navigation history, then go back to home
        if (wallet.isDefault()) {
          $ionicHistory.clearHistory();

          return $ionicHistory.clearCache()
            .then(function() {
              return $scope.showHome();
            });
        }
        else {

        }
      })
      .catch(UIUtils.onError());
  };

  // Do authentification
  $scope.doAuth = function(options) {
    var wallet = options && options.wallet || csWallet;
    return wallet.auth()
      .then(UIUtils.loading.hide);
  };

  // If connected and same pubkey
  $scope.isUserPubkey = function(pubkey) {
    return csWallet.isUserPubkey(pubkey);
  };

  // add listener on wallet event
  csWallet.api.data.on.login($scope, function(data, deferred) {
    $scope.login = true;
    return deferred ? deferred.resolve() : $q.when();
  });
  csWallet.api.data.on.logout($scope, function() {
    $scope.login = false;
  });
  csWallet.api.data.on.auth($scope, function(data, deferred) {
    $scope.auth = true;
    return deferred ? deferred.resolve() : $q.when();
  });
  csWallet.api.data.on.unauth($scope, function() {
    $scope.auth = false;
  });

  ////////////////////////////////////////
  // Useful modals
  ////////////////////////////////////////

  // Open transfer modal
  $scope.showTransferModal = function(parameters) {
    return Modals.showTransfer(parameters);
  };

  $scope.showAboutModal = function() {
    return Modals.showAbout();
  };

  $scope.showJoinModal = function() {
    $scope.closeProfilePopover();
    return Modals.showJoin();
  };

  $scope.showSettings = function() {
    $scope.closeProfilePopover();
    return $state.go('app.settings');
  };

  $scope.showHelpModal = function(parameters) {
    return Modals.showHelp(parameters);
  };


  ////////////////////////////////////////
  // Useful popovers
  ////////////////////////////////////////

  $scope.showProfilePopover = function(event) {
    return UIUtils.popover.show(event, {
      templateUrl :'templates/common/popover_profile.html',
      scope: $scope,
      autoremove: true,
      afterShow: function(popover) {
        $scope.profilePopover = popover;
        $timeout(function() {
          UIUtils.ink({selector: '#profile-popover .ink, #profile-popover .ink-dark'});
        }, 100);
      }
    });
  };

  $scope.closeProfilePopover = function() {
    if ($scope.profilePopover && $scope.profilePopover.isShown()) {
      $timeout(function(){$scope.profilePopover.hide();});
    }
  };
  // Change peer info
  $scope.showPeerInfoPopover = function(event) {
    return UIUtils.popover.show(event, {
      templateUrl: 'templates/network/popover_peer_info.html',
      autoremove: true,
      scope: $scope.$new(true)
    });
  };

  ////////////////////////////////////////
  // Link managment (fix issue #)
  ////////////////////////////////////////

  $scope.openLink = function($event, uri, options) {
    $event.stopPropagation();
    $event.preventDefault();

    options = options || {};

    // If unable to open, just copy value
    options.onError = function() {
      return UIUtils.popover.copy($event, uri);
    };

    csHttp.uri.open(uri, options);

    return false;
  };

  ////////////////////////////////////////
  // Layout Methods
  ////////////////////////////////////////
  $scope.showFab = function(id, timeout) {
    UIUtils.motion.toggleOn({selector: '#'+id + '.button-fab'}, timeout);
  };

  $scope.hideFab = function(id, timeout) {
    UIUtils.motion.toggleOff({selector: '#'+id + '.button-fab'}, timeout);
  };

  // Could be override by subclass
  $scope.doMotion = function(options) {
    return $scope.motion.show(options);
  };

}


function HomeController($scope, $state, $timeout, $ionicHistory, csPlatform, csCurrency) {
  'ngInject';

  $scope.loading = true;

  $scope.enter = function(e, state) {
    if (state && state.stateParams && state.stateParams.error) { // Error query parameter
      $scope.error = state.stateParams.error;
      $scope.node = csCurrency.data.node;
      $scope.loading = false;
      $ionicHistory.nextViewOptions({
        disableAnimate: true,
        disableBack: true,
        historyRoot: true
      });
      $state.go('app.home', {error: undefined}, {
        reload: false,
        inherit: true,
        notify: false});
    }
    else {
      // Start platform
      csPlatform.ready()
        .then(function() {
          $scope.loading = false;
        })
        .catch(function(err) {
          $scope.node =  csCurrency.data.node;
          $scope.loading = false;
          $scope.error = err;
        });
    }
  };
  $scope.$on('$ionicView.enter', $scope.enter);

  $scope.reload = function() {
    $scope.loading = true;
    delete $scope.error;

    $timeout($scope.enter, 200);
  };

  /**
   * Catch click for quick fix
   * @param event
   */
  $scope.doQuickFix = function(event) {
    if (event == 'settings') {
      $ionicHistory.nextViewOptions({
        historyRoot: true
      });
      $state.go('app.settings');
    }
  };

  // For DEV ONLY
  /*$timeout(function() {
   $scope.loginAndGo();
   }, 500);*/
}

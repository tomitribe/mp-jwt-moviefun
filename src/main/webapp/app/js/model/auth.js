/**
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

(function () {
    'use strict';

    var deps = ['lib/underscore', 'backbone', 'jwt_decode', 'app/js/model/login', 'lib/moment', 'app/js/tools/alert.view', 'lib/backbone-localstorage'];
    define(deps, function (_, Backbone, jwtDecode, LoginModel, moment, AlertView) {
        var AuthModel = Backbone.Model.extend({
            id: 'ux.auth',
            localStorage: new Store('ux.auth'),
            defaults: {
                auth: false,
                username: '',
                email: '',
                groups: '',

                access_token: '',
                access_exp: '',

                token_type: '',
                expires_in: '',

                refresh_token: '',
                refresh_exp: ''
            },
            loginModel: null,
            ref: null,
            initialize: function () {
                var me = this;
                me.loginModel = new LoginModel();
                me.ref = _.throttle( function() {
                    if (!me.refreshTimeout) me.refreshRunner();
                }, 5000);
                $.ajaxSetup({
                    beforeSend: function ( jqXHR ) {
                        var access_token = me.get('access_token'), token_type = me.get('token_type') + " ";
                        if (typeof access_token !== 'undefined' && !!access_token) {
                            jqXHR.setRequestHeader('Authorization', token_type + access_token);
                        }
                        me.checkRefresh(jqXHR);
                    }
                });

                var originalNavigate = Backbone.history.navigate;
                Backbone.history.navigate = function(fragment, options){
                    originalNavigate.apply(this, arguments);
                    me.checkRefresh();
                }
            },
            checkRefresh: function(jqXHR) {
                var me = this;
                const now = moment().valueOf(),
                    access_exp = me.get('access_exp'),
                    refresh_exp = me.get('refresh_exp'),
                    router = window.BackboneApp.getRouter(),
                    left = (access_exp - now),
                    leftRe = (refresh_exp - now);
                if ( !refresh_exp || leftRe < 0 ) {
                    me.logout().then(
                        function () {
                            router.navigate('login', {
                                trigger: true
                            });
                            AlertView.show('Warning', 'Access expired by refresh timeout, logged out.', 'warning');
                        }
                    );
                    jqXHR && jqXHR.abort();
                } else if ( !access_exp || left < 0 ) {
                    me.logout().then(
                        function () {
                            router.navigate('login', {
                                trigger: true
                            });
                            AlertView.show('Warning', 'Access expired by inactivity timeout, logged out.', 'warning');
                        }
                    );
                    jqXHR && jqXHR.abort();
                } else { me.ref(); }
            },
            login: function(creds) {
                var me = this;
                return new Promise( function (res, rej) {
                    me.loginModel.getAccess(creds)
                        .then(function (resp) {
                            me.parseResp(resp);
                            me.save();
                            me.getAuth().then(res).catch(rej);
                        })
                        .catch(rej);
                })
            },
            logout: function() {
                var me = this;
                return new Promise( function (res, rej) {
                    me.parseResp();
                    me.save();
                    res(!me.get('auth'));
                });
            },
            refresh: function() {
                var me = this;
                return new Promise( function (res, rej) {
                    const rt = me.get('refresh_token');
                    if (!rt) return rej('no token to refresh');
                    me.loginModel.getRefresh(rt)
                        .then(function (resp) {
                            me.parseResp(resp);
                            me.getAuth().then(res).catch(rej);
                        })
                        .catch(rej);
                })
            },
            parseResp: function(resp) {
                var me = this;
                var access_token = resp && resp['access_token'] && jwtDecode(resp['access_token']);
                var refresh_token = resp && resp['refresh_token'] && jwtDecode(resp['refresh_token']);
                if (resp && resp['access_token'] && access_token) {
                    const access_exp = moment.unix(access_token.exp).valueOf(),
                        refresh_exp = moment.unix(refresh_token.exp).valueOf();
                    me.set({
                        auth: true,
                        username: access_token['username'],
                        email: access_token['email'],
                        groups: access_token['groups'],

                        access_token: resp['access_token'],
                        access_exp: access_exp,

                        token_type: resp['token_type'],
                        expires_in: resp['expires_in'],

                        refresh_token: resp['refresh_token'],
                        refresh_exp: refresh_exp
                    });
                } else {
                    me.set({
                        auth: false,
                        username: '',
                        email: '',
                        groups: '',

                        access_token: '',
                        access_exp: '',

                        token_type: '',
                        expires_in: '',

                        refresh_token: '',
                        refresh_exp: ''
                    });
                }
            },
            refreshTimeout: null,
            refreshRunner: function(timeout) {
                var me = this;
                me.refreshTimeout && clearTimeout(me.refreshTimeout);
                me.getAuth().then( function () {
                    me.refreshTimeout = setTimeout(function(){
                        const now = moment().valueOf(),
                            access_exp = me.get('access_exp'),
                            left = (access_exp - now),
                            min = 60 * 1000;
                        if (left > 12 * min) {
                            // Uncomment if inactivity checker is not needed
                            //me.refreshRunner(10 * min);
                        } else if (left > 4 * min) {
                            me.refreshRunner(left - 2 * min);
                        } else {
                            me.refresh();
                        }
                    }, timeout);
                });
            },
            getAuth: function() {
                var me = this;
                return new Promise(function(res, rej) {
                    me.get('auth') ? res() : rej();
                })
            }
        });
        return AuthModel;

    });
}());

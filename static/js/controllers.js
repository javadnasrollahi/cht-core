var db = require('db').current(),
    _ = require('underscore'),
    utils = require('kujua-utils'),
    sms_utils = require('kujua-sms/utils'),
    reporting = require('kujua-reporting/shows');

require('views/lib/couchfti').addFTI(db);

(function () {

  'use strict';

  var inboxControllers = angular.module('inboxControllers', []);

  inboxControllers.controller('InboxCtrl', 
    ['$scope', '$route', '$location', '$translate', '$animate', 'Facility', 'Settings', 'Form', 'Contact', 'Language', 'ReadMessages', 'MarkRead', 'Verified', 'DeleteMessage', 'UpdateFacility', 'UpdateUser', 'SendMessage', 'User', 'UserCtxService', 'RememberService',
    function ($scope, $route, $location, $translate, $animate, Facility, Settings, Form, Contact, Language, ReadMessages, MarkRead, Verified, DeleteMessage, UpdateFacility, UpdateUser, SendMessage, User, UserCtxService, RememberService) {

      $scope.forms = [];
      $scope.facilities = [];
      $scope.selected = undefined;
      $scope.loading = true;
      $scope.error = false;
      $scope.appending = false;
      $scope.messages = [];
      $scope.totalMessages = undefined;
      $scope.filterQuery = undefined;
      $scope.filterSimple = true;

      $scope.permissions = {
        admin: utils.isUserAdmin(UserCtxService()),
        districtAdmin: utils.isUserDistrictAdmin(UserCtxService()),
        distict: undefined
      };

      $scope.readStatus = {
        forms: { total: 0, read: 0 },
        messages: { total: 0, read: 0 }
      };

      $scope.filterModel = {
        type: 'messages',
        forms: [],
        facilities: [],
        valid: true,
        messageTypes: [{ type: 'messageincoming' }],
        date: {
          from: moment().subtract('months', 1).valueOf(),
          to: moment().valueOf()
        }
      };

      utils.checkDistrictConstraint(UserCtxService(), db, function(err, district) {
        if (err) {
          console.log(err);
        }
        $scope.permissions.district = $scope.permissions.admin ? undefined : district;
        updateAvailableFacilities();
        updateContacts();
      });

      var updateContacts = function() {
        Contact.get($scope.permissions.district).then(
          function(rows) {
            $('#send-message [name=phone]').data('options', rows);
          },
          function() {
            console.log('Failed to retrieve contacts');
          }
        );
      };

      var updateAvailableFacilities = function() {
        Facility.get($scope.permissions.district).then(
          function(res) {
            $scope.facilities = res;
          },
          function() {
            console.log('Failed to retrieve facilities');
          }
        );
      };

      Form.get().then(
        function(res) {
          $scope.forms = res;
        },
        function() {
          console.log('Failed to retrieve facilities');
        }
      );

      Settings.query(function(res) {
        if (res.settings && res.settings.reported_date_format) {
          RememberService.dateFormat = res.settings.reported_date_format;
        }
      });

      Language.get().then(
        function(language) {
          $translate.use(language);
        },
        function() {
          console.log('Failed to retrieve language');
        }
      );

      var updateReadStatus = function () {
        ReadMessages.get({
          user: UserCtxService().name
        }).then(
          function(res) {
            $scope.readStatus = res;
          },
          function() {
            console.log('Failed to retrieve read status');
          }
        );
      };

      var disableModal = function(modal) {
        modal.find('.submit').text('Updating...');
        modal.find('.btn, [name]').attr('disabled', true);
      };

      var enableModal = function(modal, err) {
        if (!err) {
          modal.modal('hide');
        }
        modal.find('.modal-footer .note').text(err || '');  
        modal.find('.submit').text('Submit');
        modal.find('.btn, [name]').attr('disabled', false);
      };

      $scope.setMessage = function(id) {
        var path = [ $scope.filterModel.type ];
        if (id) {
          path.push(id);
        }
        $location.path(path.join('/'));
      };

      $scope.selectMessage = function(id) {
        if ($scope.selected && $scope.selected._id === id) {
          return;
        }
        _selectedDoc = id;
        if (id) {
          $scope.selected = undefined;
          $scope.messages.forEach(function(message) {
            if (message._id === id) {
              if (!$scope.isRead(message)) {
                var type = message.form ? 'forms' : 'messages';
                $scope.readStatus[type].read++;
                MarkRead.update(id, true);
              }
              $scope.selected = message;
            }
          });
          window.setTimeout(function() {
            $('body').addClass('show-content');
          }, 1);
        } else {
          window.setTimeout(function() {
            $('body').removeClass('show-content');
          }, 1);
          if (!$('#back').is(':visible')) {
            $scope.selected = undefined;
          }
        }
      };

      var _deleteMessage = function(id) {
        if ($scope.selected && $scope.selected._id === id) {
          $scope.selected = undefined;
        }
        for (var i = 0; i < $scope.messages.length; i++) {
          if (id === $scope.messages[i]._id) {
            $scope.messages.splice(i, 1);
            return;
          }
        }
      };

      var _findMessage = function(id) {
        for (var i = 0; i < $scope.messages.length; i++) {
          if (id === $scope.messages[i]._id) {
            return $scope.messages[i];
          }
        }
      };

      $scope.update = function(updated) {
        for (var i = 0; i < updated.length; i++) {
          var newMsg = updated[i];
          var oldMsg = _findMessage(newMsg._id);
          if (oldMsg) {
            if (newMsg._rev !== oldMsg._rev) {
              for (var prop in newMsg) {
                if (newMsg.hasOwnProperty(prop)) {
                  oldMsg[prop] = newMsg[prop];
                }
              }
            }
          } else {
            $scope.messages.push(newMsg);
          }
        }
      };

      $scope.isRead = function(message) {
        message.read = message.read || [];
        if ($scope.selected && $scope.selected._id === message._id) {
          return true;
        }
        var user = UserCtxService().name;
        for (var i = 0; i < message.read.length; i++) {
          if (message.read[i] === user) {
            return true;
          }
        }
        return false;
      };

      var _getFilterString = function() {

        var formatDate = function(date) {
          return date.format('YYYY-MM-DD');
        };

        var filters = [];

        if ($scope.filterSimple) {

          // increment end date so it's inclusive
          var to = moment($scope.filterModel.date.to).add('days', 1);
          var from = moment($scope.filterModel.date.from);

          filters.push(
            'reported_date<date>:[' + 
            formatDate(from) + ' TO ' + formatDate(to) + 
            ']'
          );

          if ($scope.filterModel.type === 'messages') {

            if ($scope.filterModel.messageTypes.length) {
              var types = [];
              $scope.filterModel.messageTypes.forEach(function(value) {
                var filter = 'type:' + value.type;
                if (value.state) {
                  filter = '(' + filter + ' AND state:' + value.state + ')';
                }
                types.push(filter);
              });
              filters.push('(' + types.join(' OR ') + ')');
            } else {
              filters.push('type:message*');
            }

          } else {

            filters.push('type:report');
            var selectedForms = $scope.filterModel.forms.length;
            if (selectedForms > 0 && selectedForms < $scope.forms.length) {
              var formCodes = [];
              $scope.filterModel.forms.forEach(function(form) {
                formCodes.push(form.code);
              });
              filters.push('form:(' + formCodes.join(' OR ') + ')');
            }
            if ($scope.filterModel.valid === true) {
              filters.push('errors<int>:0');
            } else if ($scope.filterModel.valid === false) {
              filters.push('NOT errors<int>:0');
            }

          }

          var selectedFacilities = $scope.filterModel.facilities.length;
          if (selectedFacilities > 0 && selectedFacilities < $scope.facilities.length) {
            filters.push('clinic:(' + $scope.filterModel.facilities.join(' OR ') + ')');
          }

        } else {

          if ($scope.filterQuery && $scope.filterQuery.trim()) {
            filters.push($scope.filterQuery);
          }
          var type = $scope.filterModel.type === 'messages' ?
            'message*' : 'report';
          filters.push('type:' + type);

        }

        return filters.join(' AND ');
      };

      var _currentQuery;
      var _selectedDoc;

      $scope.query = function(options) {
        if ($scope.filterModel.type === 'analytics') {
          // no search available for analytics
          return;
        }
        if (options.query === _currentQuery && !options.changes) {
          // debounce as same query already running
          return;
        }
        _currentQuery = options.query;
        $animate.enabled(!!options.changes);
        if (options.changes) {
          updateReadStatus();
          var changedRows = options.changes.results;
          for (var i = changedRows.length - 1; i >= 0; i--) {
            if (changedRows[i].deleted) {
              _deleteMessage(changedRows[i].id);
              changedRows.splice(i, 1);
            }
          }
          if (!changedRows.length) {
            // nothing to update
            return;
          }
        }
        if (!options.silent) {
          $scope.error = false;
          $scope.loading = true;
        }
        if (options.skip) {
          $scope.appending = true;
          options.skip = $scope.messages.length;
        } else if (!options.silent) {
          $scope.messages = [];
        }
/*
        if (options.district) {
            options.query += ' AND district:' + options.district
        }
*/
        if (options.changes && options.changes.results.length) {
            var updatedIds = _.map(options.changes.results, function(result) {
                return '"' + result.id + '"';
            });
            options.query += ' AND uuid:(' + updatedIds.join(' OR ') + ')';
        }
        db.getFTI(
          'medic',
          'data_records',
          {
              limit: 50,
              q: options.query,
              skip: options.skip || 0,
              sort: '\\reported_date',
              include_docs: true
          },
          function(err, data) {
            _currentQuery = null;
            if ($scope.filterModel.type === 'analytics') {
              // no search available for analytics
              return;
            }
            angular.element($('body')).scope().$apply(function($scope) {
              $scope.loading = false;
              if (err) {
                $scope.error = true;
                console.log('Error loading messages', err);
              } else {
                $scope.error = false;
                data.rows = _.map(data.rows, function(row) {
                    return sms_utils.makeDataRecordReadable(row.doc, sms_utils.info);
                });
                $scope.update(data.rows);
                if (!options.changes) {
                  $scope.totalMessages = data.total_rows;
                }
                if (_selectedDoc) {
                  $scope.selectMessage(_selectedDoc);
                }
              }
              $scope.appending = false;
            });
          }
        );
      };

      $scope.filter = function(options) {
        options = options || {};
        options.query = _getFilterString();
        $scope.query(options);
      };

      $scope.verify = function(verify) {
        if ($scope.selected.form) {
          Verified.update($scope.selected._id, verify);
        }
      };

      $scope.deleteMessage = function() {
        DeleteMessage.delete($scope.selected._id);
        $('#delete-confirm').modal('hide');
      };

      $scope.updateFacility = function() {
        var facilityId = $('#update-facility [name=facility]').val();
        if (!facilityId) {
            $('#update-facility .modal-footer .note').text('Please select a facility');
            return;
        }
        UpdateFacility.update($scope.selected._id, facilityId);
        $('#update-facility').modal('hide');
      };

      $scope.editUser = function() {
        var $modal = $('#edit-user-profile');
        UpdateUser.update({
          fullname: $modal.find('#fullname').val(),
          email: $modal.find('#email').val(),
          phone: $modal.find('#phone').val(),
          language: $modal.find('#language').val()
        });
        $modal.modal('hide');
      };

      $scope.sendMessage = function() {

        var validateSms = function($phoneField, $messageField) {

          var validateMessage = function(message) {
            return {
              valid: !!message,
              message: 'Please include a message.'
            };
          };

          var validatePhoneNumber = function(data) {
            var phoneValidationRegex = /.*?(\+?[\d]{5,15}).*/;
            var contact = data.doc.contact;
            return data.everyoneAt || (
              contact && phoneValidationRegex.test(contact.phone)
            );
          };

          var validatePhoneNumbers = function(recipients) {

            // recipients is mandatory
            if (!recipients || recipients.length === 0) {
              return {
                valid: false,
                message: 'Please include a valid phone number, ' +
                         'e.g. +9779875432123'
              };
            }

            // all recipients must have a valid phone number
            var errors = _.filter(recipients, function(data) {
              return !validatePhoneNumber(data);
            });
            if (errors.length > 0) {
              var errorRecipients = _.map(errors, function(error) {
                return error.text;
              }).join(', ');
              return {
                valid: false,
                message: 'These recipients do not have a valid ' + 
                         'contact number: ' + errorRecipients
              };
            }

            return {
              valid: true,
              message: '',
              value: recipients
            };
          };

          var updateValidationResult = function(fn, elem, value) {
            var result = fn.call(this, value);
            elem.closest('.control-group')
                .toggleClass('error', !result.valid)
                .find('.help-block')
                .text(result.valid ? '' : result.message);

            return result.valid;
          };

          var phone = updateValidationResult(
              validatePhoneNumbers,
              $phoneField, 
              $phoneField.select2('data')
          );
          var message = updateValidationResult(
              validateMessage, 
              $messageField, 
              $messageField.val().trim()
          );

          return phone && message;

        };

        if ($('#send-message').find('.submit [disabled]').length) {
          return;
        }

        var $modal = $('#send-message');
        var $phone = $modal.find('[name=phone]');
        var $message = $modal.find('[name=message]');

        if (!validateSms($phone, $message)) {
          return;
        }

        disableModal($modal);

        SendMessage.send($phone.select2('data'), $message.val().trim()).then(
          function() {
            enableModal($modal);
          },
          function(err) {
            enableModal($modal, err);
          }
        );
      };

      $scope.$watch('filterModel', $scope.filter, true);
      $scope.$watch('filterModel.type', function() { 
        $scope.selected = undefined; 
        if ($scope.filterModel.type === 'analytics') {
          $scope.filterSimple = true;
        }
      });

      $scope.filter();
      updateReadStatus();

    }
  ]);

  inboxControllers.controller('MessagesCtrl', 
    ['$scope', '$route', 
    function ($scope, $route) {
      $scope.filterModel.type = 'messages';
      $scope.selectMessage($route.current.params.doc);
    }
  ]);


  inboxControllers.controller('ReportsCtrl', 
    ['$scope', '$route', 
    function ($scope, $route) {
      $scope.filterModel.type = 'reports';
      $scope.selectMessage($route.current.params.doc);
    }
  ]);


  inboxControllers.controller('AnalyticsCtrl', 
    ['$scope', 
    function ($scope) {
      $scope.filterModel.type = 'analytics';
      $scope.selectMessage();
      reporting.render_page();
    }
  ]);

}());
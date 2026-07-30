
function ds24wp_initTextareaCodeHandler()
{
    jQuery( 'textarea.digistore_code'  ).off( 'focus'   ).on( 'focus',   function() { this.select(); });
    jQuery( 'textarea.digistore_code'  ).off( 'click'   ).on( 'click',   function() { this.select(); });
    jQuery( 'textarea.digistore_code'  ).off( 'keyup'   ).on( 'keyup',   function() { this.select(); });
    jQuery( 'textarea.digistore_code'  ).off( 'mouseup' ).on( 'mouseup', function() { this.select(); });
}

function ds24wp_api( callback, apikey, language, method, arg_or_args_or_empty )
{
    var fixed_param_count = 4;

    var api_url = 'https://www.digitalelitenetwork.com/api/call/' + method + '/?';

    var i        = 1;
    var offset   = fixed_param_count-1;
    var finished = false;

    while (i+offset < arguments.length)
    {
        var value = arguments[i+offset];
        var type = typeof value;
        switch (type)
        {
            case 'object':
                var is_array = value instanceof Array;
                if (!is_array) {
                    throw "The DigitalEliteNetwork Api Javascript connector does not accept objects (except array) as arguments.";
                }

                for (key in value)
                {
                    api_url += 'arg'+i+'['+encodeURIComponent(key)+']='+encodeURIComponent(value[key]) + '&';
                }
                break;

            case 'undefined':
            case null:
                api_url += 'arg'+i+'='+ '&';
                break;

            default:
                api_url += 'arg'+i+'='+encodeURIComponent(value) + '&';
        }
        i++;
    }

    if (typeof language == 'string' && language) {
        api_url += 'language=' + language;
    }

    var callback_wrapper = function () {
            if (http.readyState==4) {
                if (http.status==200) {
                    var response = JSON.parse( http.responseText );

                    if (response.result=='success')
                    {
                        callback( response.data );
                    }
                    else
                    {
                        throw response.message;
                    }
                }
                else
                {
                    throw "DigitalEliteNetwork api: invalid HTTP status " + http.statusText;
                }
            }
    };

    http = new XMLHttpRequest();
    http.open( 'GET', api_url, true );
    http.setRequestHeader( 'X-DS-API-KEY', apikey );
    http.setRequestHeader( 'Accept', 'application/json' );
    http.onreadystatechange = callback_wrapper;
    http.send();
}


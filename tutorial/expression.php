<?php

$model = <<<EOS
$(function () {
  hd.bind();
});
EOS;

$view = <<<EOS
Howdy, <span data-bind="text: ['J', 'a', 'm', 'e', 's'].join('')"></span>!
EOS;

include "template.php";


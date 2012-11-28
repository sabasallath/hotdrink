<?php

$model = <<<EOS
var Model = hd.model(function () {
  this.length = hd.variable(3);
  this.width  = hd.variable(4);
  this.area   = hd.variable();

  hd.constraint()
    .method(this.length, function () {
      this.length(this.area() / this.width());
    })
    .method(this.width, function () {
      this.width(this.area() / this.length());
    })
    .method(this.area, function () {
      this.area(this.length() * this.width());
    });
});

$(function () {
  hd.bind(new Model);
});
EOS;

$view = <<<EOS
<p>
  Length: <input type="text" data-bind="number: length" />
  <br />
  Width: <input type="text" data-bind="number: width" />
  <br />
  Area: <input type="text" data-bind="number: area" />
</p>
EOS;

include "template.php";

